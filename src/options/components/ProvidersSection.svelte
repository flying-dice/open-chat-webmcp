<script lang="ts">
  // TODO: clean-code - 0.4 - SRP: bundles provider CRUD, permission-grant tracking, a per-provider tool-capable-model capability/staleness subsystem, stale-default-selection detection, and the two-step add-provider flow state machine in one component.
  // Provider registry management (card 22,
  // decisions/10-provider-registry-and-credential-storage.md): the CRUD +
  // reorder + set-default UI on top of the `ProviderRegistry` port, which
  // already implements every storage operation this component calls.
  //
  // Card 78: that header used to end "nothing here talks to chrome.storage
  // directly" while this component made five `chrome.permissions` calls a few
  // lines below it — true about storage, misleading about everything else.
  // It talks to no platform API at all now: the registry, the client factory
  // and the `HostPermissions` port all arrive from src/options/app-services.ts,
  // and `npm run guard:boundaries` is what keeps that true rather than a
  // comment.
  //
  // Card 71 (decisions/28-shadcn-svelte-maia-zinc.md): options.css's
  // `.section`/`.note`/`.empty-state`/`.toolbar` became shadcn
  // `Card`/`Alert`/`Empty`/`Button`. No flow changed — the add step machine,
  // the optimistic reorder and the permission-first test handler below are
  // byte-for-byte what they were.
  import { onMount } from "svelte";
  import {
    resolveSelection,
    type ProviderConfig,
    type ProviderSelection,
  } from "../../domain/providers";
  import { fail, ok, type Result } from "../../domain/result";
  import type { StorageError } from "../../domain/storage";
  import { storageFailureMessage } from "../../ui/storageMessage";
  import { optionsServices } from "../app-services";
  import {
    describeProviderError,
    isSelectable,
    reasonForCapability,
    resolveCapabilities,
    resolveCapability,
    type ChatProvider,
    type ModelCapabilities,
    type ProviderModel,
    type ProviderPreset,
  } from "../../domain/providers";
  import { testProviderConnection, type TestOutcome } from "../forms/testConnection";
  import PresetPicker from "./PresetPicker.svelte";
  import ProviderForm from "./ProviderForm.svelte";
  import ProviderRow from "./ProviderRow.svelte";
  import * as Alert from "$lib/components/ui/alert";
  import * as Card from "$lib/components/ui/card";
  import * as Empty from "$lib/components/ui/empty";
  import { Button } from "$lib/components/ui/button";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { PlugSocketIcon, PlusSignIcon } from "@hugeicons/core-free-icons";

  let providers = $state<ProviderConfig[]>([]);
  let defaultSelection = $state<ProviderSelection | undefined>(undefined);
  let loading = $state(true);
  /** Card 95: this section's storage-failure line — a read that left the list stale, or a write that did not land. Cleared by the next successful refresh. Form saves report into the form itself instead (see `reportWriteFailure`). */
  let failure = $state<string | undefined>(undefined);

  /**
   * Card 52: one provider's tool-capable model options for the "Set as
   * default" dropdown — loaded the same way the side panel's picker loads a
   * provider's model list (`client.listModels()` + `resolveCapabilities`,
   * both shared via src/domain/providers/capability.ts), narrowed down to what
   * a single dropdown needs rather than the panel's full grouped-list UI
   * (decisions/23's accepted "options page duplicates a small slice of the
   * side panel's per-provider model-loading shape").
   *
   * `"loaded"`'s `options` is PRE-FILTERED to tool-capable models only
   * (`isSelectable`) — ProviderRow's model dropdown never has to re-check
   * capability itself, and an empty `options` array is exactly the "loaded,
   * but nothing tool-capable" blocked state (decisions/11, decisions/23).
   */
  type DefaultModelOptionsState =
    | { status: "loading" }
    | { status: "loaded"; options: { model: ProviderModel; capability: ModelCapabilities }[] }
    | { status: "error"; message: string }
    | { status: "not-supported"; message: string };

  /** Every provider's `DefaultModelOptionsState`, keyed by provider id — loaded in parallel, degrading independently per provider (decisions/22's discipline, same as src/sidepanel/stores/selection.svelte.ts's `providerModelsState`). Absent key = never (yet) requested. */
  let defaultModelOptionsState = $state<Record<string, DefaultModelOptionsState>>({});

  /** Per-provider load generation, guarding a stale response from a superseded reload for that SAME provider — mirrors src/sidepanel/stores/selection.svelte.ts's `providerTokens` doc comment: one token per provider id, never a single shared one, so reloading provider A can never discard an in-flight load for provider B. Not `$state` — internal bookkeeping only. */
  const defaultModelOptionsTokens: Record<string, number> = {};

  /**
   * Card 41's fourth checklist item: an ALREADY-STORED default (set before
   * this check existed, or one whose model's capability/availability has
   * since changed — e.g. the model was removed, or the provider was) must
   * surface clearly rather than silently seeding a broken chat. `undefined`
   * means the current default is fine (or there isn't one); otherwise this
   * carries the exact reason to show in the warning banner below.
   */
  let staleDefaultReason = $state<string | undefined>(undefined);

  /**
   * The add-provider flow's two steps (card 50, decisions/21): "choose"
   * shows `PresetPicker`, "form" shows `ProviderForm` pre-filled from
   * whichever backend (or `undefined` for Custom) was picked. `chosenPreset`
   * is only meaningful while `addStep === "form"`.
   */
  let addStep = $state<"closed" | "choose" | "form">("closed");
  let chosenPreset = $state<ProviderPreset | undefined>(undefined);
  let editingId = $state<string | null>(null);

  /** `undefined` per id while its grant check is in flight — kept distinct from a settled `false` so the badge never briefly flashes "needed". */
  let permissionGranted = $state<Record<string, boolean | undefined>>({});
  let testOutcomes = $state<Record<string, TestOutcome | undefined>>({});
  let testingIds = $state<Record<string, boolean>>({});

  // TODO: clean-code - 0.45 - DRY: refreshPermissions (Promise.all + Object.fromEntries over cached grants) and handleMove/handleTest below are the same generic reorder/permission-gate plumbing duplicated a second time in McpServersSection.svelte, with no domain-specific reason left to be typed twice.
  async function refreshPermissions(): Promise<void> {
    const entries = await Promise.all(
      providers.map(
        async (p) => [p.id, await optionsServices().permissions.has(p.baseUrl)] as const,
      ),
    );
    permissionGranted = Object.fromEntries(entries);
  }

  /*
   * REMOVED (card 95): `buildClient`, the `try/catch` twin of the one
   * src/sidepanel/stores/selection.svelte.ts carried — see that file for the
   * full reasoning. Short version: `createProviderClient` has been the
   * exhaustive `Record<ProviderType, …>` dispatcher since card 75, so the
   * catch guarded a state the compiler already rules out, and the
   * "No client is registered for provider type …" messages it fed are gone
   * with it rather than being left as unreachable copy.
   */

  /**
   * Load (or reload) ONE provider's tool-capable model options — the unit of
   * "degrade per provider" (decisions/22, mirroring
   * src/sidepanel/stores/selection.svelte.ts's `loadModelsForProvider`):
   * callers fire this once per provider without awaiting each other, so a
   * slow/unreachable provider's `listModels()` never delays another
   * provider's write to `defaultModelOptionsState`.
   */
  // TODO: clean-code - 0.45 - DRY: duplicates at length the same per-provider-token-guarded "listModels -> branch on error kind -> resolveCapabilities -> filter selectable" sequence as src/sidepanel/stores/selection.svelte.ts's loadModelsForProvider, instead of sharing an extracted helper.
  async function loadDefaultModelOptions(provider: ProviderConfig): Promise<void> {
    const token = (defaultModelOptionsTokens[provider.id] ?? 0) + 1;
    defaultModelOptionsTokens[provider.id] = token;
    defaultModelOptionsState[provider.id] = { status: "loading" };

    const client = optionsServices().createProviderClient(provider);
    const [models, listErr] = await client.listModels();
    if (defaultModelOptionsTokens[provider.id] !== token) return; // superseded by a later reload for this provider

    if (listErr) {
      if (listErr.kind === "not-supported") {
        defaultModelOptionsState[provider.id] = {
          status: "not-supported",
          message: describeProviderError(listErr),
        };
        return;
      }
      defaultModelOptionsState[provider.id] = {
        status: "error",
        message: describeProviderError(listErr),
      };
      return;
    }

    const entries = await resolveCapabilities(client, models);
    if (defaultModelOptionsTokens[provider.id] !== token) return; // superseded by a later reload for this provider
    defaultModelOptionsState[provider.id] = {
      status: "loaded",
      options: entries.filter((e) => isSelectable(e.capability)),
    };
  }

  /** Reload every currently-registered provider's model options, in parallel — each provider's fetch settles and writes its own slot independently (decisions/22). */
  async function refreshDefaultModelOptions(): Promise<void> {
    await Promise.all(providers.map((p) => loadDefaultModelOptions(p)));
  }

  /**
   * Card 41's fourth checklist item: check whether the CURRENTLY STORED
   * default is still valid — its provider still registered, its model still
   * resolving to `"tool-capable"` — so a default that went stale after being
   * set (model removed/re-pulled without tools, provider deleted) surfaces a
   * clear reason rather than silently seeding a new chat with it.
   */
  async function refreshStaleDefault(): Promise<void> {
    if (!defaultSelection) {
      staleDefaultReason = undefined;
      return;
    }
    const [resolved, resolveErr] = await resolveSelection(
      optionsServices().providers,
      defaultSelection,
    );
    if (resolveErr) {
      // Card 92: an unreadable registry is not evidence that the default is
      // stale, so this banner stays silent rather than accusing a provider
      // that may be perfectly fine.
      staleDefaultReason = undefined;
      return;
    }
    if (resolved.status !== "ok") {
      staleDefaultReason = "The provider it points to has been removed.";
      return;
    }
    const client = optionsServices().createProviderClient(resolved.config);
    const capability = await resolveCapability(client, {
      id: resolved.model,
      name: resolved.model,
    });
    staleDefaultReason = isSelectable(capability)
      ? undefined
      : (reasonForCapability(capability) ?? "This model can't be confirmed as tool-capable.");
  }

  async function refresh(): Promise<void> {
    const registry = optionsServices().providers;
    const [loaded, listErr] = await registry.listProviders();
    // Card 92 kept the previous list showing rather than emptying the page
    // and implying the user has no providers; card 95 puts the reason where
    // they can read it, which matters more here than on most sections — an
    // empty-looking provider list is exactly the state someone would "fix"
    // by re-adding a provider they already have.
    if (listErr) {
      failure = storageFailureMessage("Couldn't load your saved providers", listErr);
      return;
    }
    providers = loaded;
    const [storedDefault, defaultErr] = await registry.getDefaultSelection();
    if (defaultErr) {
      failure = storageFailureMessage("Couldn't read which provider is your default", defaultErr);
      return;
    }
    failure = undefined;
    defaultSelection = storedDefault;

    // Drop model-option state for providers that no longer exist, so a
    // deleted provider can't leave a stale entry behind if it's ever
    // re-added under a reused id (mirrors selection.svelte.ts's `loadProviders`).
    const liveIds = new Set(providers.map((p) => p.id));
    for (const id of Object.keys(defaultModelOptionsState)) {
      if (!liveIds.has(id)) delete defaultModelOptionsState[id];
    }

    await Promise.all([refreshPermissions(), refreshDefaultModelOptions(), refreshStaleDefault()]);
  }

  onMount(() => {
    refresh().finally(() => {
      loading = false;
    });

    // Keep the "Permission needed" / "Permission granted" badges live if the
    // user grants or revokes a host permission from chrome://extensions
    // while this page is open, not just right after a Test Connection click.
    // Card 78: the `chrome.permissions.onAdded`/`onRemoved` pair behind this
    // is the port's `onChanged`, which hands back one teardown.
    return optionsServices().permissions.onChanged(() => {
      refreshPermissions();
    });
  });

  /**
   * Card 92: every write handler below bails on a returned `StorageError`
   * instead of carrying on — a form that did not save must not close, a
   * removed row must not disappear, a default that did not persist must not
   * be shown as set. Card 95 keeps that CONTROL FLOW exactly as it was and
   * replaces the `console.warn` it stood on with this section's alert.
   *
   * The two FORM writes do not come through here: `handleAddSubmit` and
   * `handleEditSubmit` hand their error back to ProviderForm.svelte instead,
   * because the form is still open with the user's input in it and an error
   * three sections up the page is not where they are looking.
   */
  // TODO: clean-code - 0.35 - DRY: the whole card-95 write-failure protocol is duplicated between this section and McpServersSection.svelte — a `failure` state field, this `reportWriteFailure(what, cause)` helper, and `handleAddSubmit`/`handleEditSubmit` typed `Promise<Result<void, StorageError>>` so the paired form (ProviderForm.svelte) can render the message under its own fields. Same shape as the four DRY markers this file pair already carries; new with the errors-as-values migration (card 96's audit), and the same decisions/20 caution applies — an extraction must not let an edit to one section silently change the other.
  function reportWriteFailure(what: string, cause: StorageError): void {
    failure = storageFailureMessage(what, cause);
  }

  async function handleAddSubmit(
    data: Omit<ProviderConfig, "id">,
  ): Promise<Result<void, StorageError>> {
    const [, err] = await optionsServices().providers.addProvider(data);
    if (err) return fail(err);
    addStep = "closed";
    chosenPreset = undefined;
    await refresh();
    return ok();
  }

  async function handleEditSubmit(
    id: string,
    data: Omit<ProviderConfig, "id">,
  ): Promise<Result<void, StorageError>> {
    const [, err] = await optionsServices().providers.updateProvider(id, data);
    if (err) return fail(err);
    editingId = null;
    await refresh();
    return ok();
  }

  async function handleRemove(provider: ProviderConfig): Promise<void> {
    const confirmed = confirm(
      `Remove "${provider.name}"? Any tab session currently using it will be left with a dangling provider and prompted to pick a replacement.`,
    );
    if (!confirmed) return;
    const [, err] = await optionsServices().providers.removeProvider(provider.id);
    if (err) return reportWriteFailure(`Couldn't remove "${provider.name}"`, err);
    delete testOutcomes[provider.id];
    delete permissionGranted[provider.id];
    await refresh();
  }

  // TODO: clean-code - 0.45 - DRY: byte-identical optimistic-reorder-then-persist logic to McpServersSection.svelte's handleMove.
  async function handleMove(index: number, direction: -1 | 1): Promise<void> {
    const target = index + direction;
    if (target < 0 || target >= providers.length) return;
    const current = providers[index];
    const swapped = providers[target];
    if (!current || !swapped) return; // both indices are in-range, checked above — this can't actually miss
    const next = [...providers];
    next[index] = swapped;
    next[target] = current;
    providers = next; // optimistic reorder while the write lands
    const [, err] = await optionsServices().providers.reorderProviders(next.map((p) => p.id));
    // The optimistic swap above already happened, so a failure here leaves
    // the list showing an order storage does not have — which is precisely
    // why card 95 says so on screen rather than in the console: `refresh()`
    // on the next mount silently puts the rows back, and a user who was not
    // told would read that as the extension forgetting their arrangement.
    if (err) reportWriteFailure("Couldn't save the new provider order", err);
  }

  /** Whether `provider`'s model options are still loading — the row shows a loading state, no reason yet (card 52). */
  function defaultModelsLoading(provider: ProviderConfig): boolean {
    const state = defaultModelOptionsState[provider.id];
    return state === undefined || state.status === "loading";
  }

  /** `provider`'s tool-capable model options, or `[]` while loading/blocked — exactly what ProviderRow's dropdown renders. */
  function defaultModelOptionsFor(
    provider: ProviderConfig,
  ): { model: ProviderModel; capability: ModelCapabilities }[] {
    const state = defaultModelOptionsState[provider.id];
    return state?.status === "loaded" ? state.options : [];
  }

  /**
   * The inline reason "Set as default" is blocked for `provider` right now —
   * `undefined` while still loading (no verdict yet) or once at least one
   * tool-capable model is available. A `not-supported` provider (no
   * model-listing API) points at the side panel's existing seed-once
   * behavior instead of reimplementing manual entry here (decisions/23); a
   * `loaded` provider with zero tool-capable models gets decisions/11's
   * plain "no tool-capable models" wording; any other `listModels()` failure
   * surfaces its own message.
   */
  function setDefaultBlockedReason(provider: ProviderConfig): string | undefined {
    const state = defaultModelOptionsState[provider.id];
    if (!state || state.status === "loading") return undefined; // still resolving — no verdict to report yet
    if (state.status === "not-supported") {
      return "This provider can't list its models. Pick a model for it once in the side panel instead — that seeds the default automatically.";
    }
    if (state.status === "error") return state.message;
    return state.options.length > 0 ? undefined : "No tool-capable models found on this provider.";
  }

  /**
   * Card 52 (carrying forward card 41's discipline): apply the same
   * three-state capability rule the side panel's picker applies
   * (decisions/11) at the point the default is actually set, not just in the
   * UI's disabled state — ProviderRow's dropdown only ever offers
   * tool-capable models, but this re-checks `modelId` against the CURRENT
   * `defaultModelOptionsState` before writing, so a stale/in-flight reload
   * can never let a no-tools/unknown (or since-removed) model become the
   * default (the same "second guard" `selectModel` keeps in
   * src/sidepanel/stores/selection.svelte.ts).
   */
  async function handleSetDefault(provider: ProviderConfig, modelId: string): Promise<void> {
    const options = defaultModelOptionsFor(provider);
    if (!options.some((o) => o.model.id === modelId)) return;

    const [, err] = await optionsServices().providers.setDefaultSelection({
      providerId: provider.id,
      model: modelId,
    });
    if (err) return reportWriteFailure("Couldn't set the default provider and model", err);
    defaultSelection = { providerId: provider.id, model: modelId };
    await refreshStaleDefault();
  }

  /**
   * "Test connection" for a saved row — MUST call `permissions.request`
   * as the first `await` when the grant isn't already known-true
   * (decisions/09): a click handler is the only place the browser honours
   * that request, and any async work ahead of it risks losing the gesture.
   */
  // TODO: clean-code - 0.45 - DRY: the "check cached grant -> permissions.request as first await -> run the test, else report the same permission-denied string" flow duplicates McpServersSection.svelte's handleTest.
  async function handleTest(provider: ProviderConfig): Promise<void> {
    testingIds = { ...testingIds, [provider.id]: true };
    testOutcomes = { ...testOutcomes, [provider.id]: undefined };

    try {
      let granted = permissionGranted[provider.id];
      if (granted !== true) {
        granted = await optionsServices().permissions.request(provider.baseUrl);
        permissionGranted = { ...permissionGranted, [provider.id]: granted };
        if (!granted) {
          testOutcomes = {
            ...testOutcomes,
            [provider.id]: {
              kind: "permission-denied",
              message:
                "This extension doesn't have permission to contact this host. Grant it when Chrome prompts, or from chrome://extensions, then try again.",
            },
          };
          return;
        }
      }
      testOutcomes = { ...testOutcomes, [provider.id]: await testProviderConnection(provider) };
    } finally {
      testingIds = { ...testingIds, [provider.id]: false };
    }
  }
</script>

<section aria-labelledby="providers-heading">
  <Card.Root>
    <Card.Header>
      <h2 id="providers-heading" class="text-base font-medium tracking-tight">Chat providers</h2>
      <Card.Description>
        Register the Ollama or OpenAI-compatible endpoints the side panel can chat through. Exactly
        one provider (and model) is the default the panel opens with.
      </Card.Description>
    </Card.Header>

    <Card.Content class="flex flex-col gap-4">
      {#if failure}
        <!-- Card 95: a storage read or write this section could not complete.
             Above the list, and never INSTEAD of it — what is listed below is
             still the last thing successfully read. -->
        <Alert.Root variant="destructive">
          <Alert.Description>{failure}</Alert.Description>
        </Alert.Root>
      {/if}

      <Alert.Root class="bg-muted/40">
        <Alert.Description>
          API keys and custom header values are stored unencrypted on this device
          (chrome.storage.local) and never synced to your Google account. Anyone with access to this
          browser profile's data can read them.
        </Alert.Description>
      </Alert.Root>

      {#if !loading && staleDefaultReason}
        <!-- Card 41's fourth checklist item: the STORED default (not merely the
             one currently displayed as selectable) is no longer valid — surface
             it clearly instead of silently letting a broken default keep
             seeding new chats. -->
        <Alert.Root variant="destructive">
          <Alert.Description>
            The default provider/model can no longer be confirmed as tool-capable: {staleDefaultReason}
            New chats seeded from it will need a different model picked in the side panel before
            they can use page tools. Pick a new default below.
          </Alert.Description>
        </Alert.Root>
      {/if}

      {#if loading}
        <p class="text-sm text-muted-foreground">Loading providers…</p>
      {:else}
        {#if providers.length === 0 && addStep === "closed"}
          <Empty.Root class="border p-8">
            <Empty.Header>
              <Empty.Media variant="icon">
                <HugeiconsIcon icon={PlugSocketIcon} strokeWidth={2} />
              </Empty.Media>
              <Empty.Title>No providers registered yet</Empty.Title>
              <Empty.Description>
                Add a provider below to let the side panel connect to Ollama or an
                OpenAI-compatible endpoint. Until then, the side panel has nothing to chat through —
                this is separate from having no tool-capable models on a provider you've already
                added.
              </Empty.Description>
            </Empty.Header>
          </Empty.Root>
        {:else if providers.length > 0}
          <div class="flex flex-col gap-2">
            {#each providers as provider, index (provider.id)}
              {#if editingId === provider.id}
                <ProviderForm
                  mode="edit"
                  initial={provider}
                  onSubmit={(data) => handleEditSubmit(provider.id, data)}
                  onCancel={() => (editingId = null)}
                />
              {:else}
                {@const isDefault = defaultSelection?.providerId === provider.id}
                <ProviderRow
                  {provider}
                  {isDefault}
                  isFirst={index === 0}
                  isLast={index === providers.length - 1}
                  permissionGranted={permissionGranted[provider.id]}
                  testOutcome={testOutcomes[provider.id]}
                  testing={testingIds[provider.id] ?? false}
                  defaultModelsLoading={defaultModelsLoading(provider)}
                  defaultModelOptions={defaultModelOptionsFor(provider).map((o) => o.model)}
                  defaultModelBlockedReason={setDefaultBlockedReason(provider)}
                  defaultInvalidReason={isDefault ? staleDefaultReason : undefined}
                  onEdit={() => (editingId = provider.id)}
                  onRemove={() => handleRemove(provider)}
                  onMoveUp={() => handleMove(index, -1)}
                  onMoveDown={() => handleMove(index, 1)}
                  onSetDefault={(modelId) => handleSetDefault(provider, modelId)}
                  onTest={() => handleTest(provider)}
                />
              {/if}
            {/each}
          </div>
        {/if}

        {#if addStep === "choose"}
          <PresetPicker
            onChoose={(preset) => {
              chosenPreset = preset;
              addStep = "form";
            }}
            onCancel={() => (addStep = "closed")}
          />
        {:else if addStep === "form"}
          <ProviderForm
            mode="add"
            preset={chosenPreset}
            onSubmit={handleAddSubmit}
            onCancel={() => {
              addStep = "closed";
              chosenPreset = undefined;
            }}
            onChangeBackend={() => (addStep = "choose")}
          />
        {:else}
          <div class="flex justify-end">
            <Button onclick={() => (addStep = "choose")}>
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} data-icon="inline-start" />
              Add provider
            </Button>
          </div>
        {/if}
      {/if}
    </Card.Content>
  </Card.Root>
</section>

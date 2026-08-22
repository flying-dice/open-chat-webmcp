<script lang="ts">
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
  //
  // Card 113 took two whole subsystems out of this file, unchanged in
  // behaviour: the per-provider tool-capable-model options and the
  // stale-stored-default check are ../forms/defaultModel.svelte.ts, and the
  // permission-grant map, the permission-gated test and card 95's
  // write-failure line are ../forms/registrySection.svelte.ts — the last
  // three shared with McpServersSection.svelte, which had typed them out a
  // second time. What is left here is this section's own job: provider CRUD,
  // the two-step add flow, and the layout.
  import { onMount } from "svelte";
  import {
    type ProviderConfig,
    type ProviderPreset,
    type ProviderSelection,
  } from "../../domain/providers";
  import { fail, ok, type Result } from "../../domain/result";
  import type { StorageError } from "../../domain/storage";
  import { optionsServices } from "../app-services";
  import {
    testProviderConnection,
    type ProviderTestOutcome,
  } from "../forms/providerTestConnection";
  import { createDefaultModelOptions, createStaleDefaultCheck } from "../forms/defaultModel.svelte";
  import { reorderStep } from "../forms/reorder";
  import {
    createRegistryTestGate,
    createSectionFailure,
    permissionDeniedOutcome,
  } from "../forms/registrySection.svelte";
  import { m } from "../../paraglide/messages.js";
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
  /** Card 95: this section's storage-failure line — a read that left the list stale, or a write that did not land. Cleared by the next successful refresh. Form saves report into the form itself instead. */
  const failure = createSectionFailure();

  /** Card 52: which tool-capable models "Set as default" may offer, per provider — see ../forms/defaultModel.svelte.ts. */
  const defaultModels = createDefaultModelOptions();
  /** Card 41's fourth checklist item: whether the STORED default still holds. */
  const staleDefault = createStaleDefaultCheck();

  /**
   * The add-provider flow's two steps (card 50, decisions/21): "choose"
   * shows `PresetPicker`, "form" shows `ProviderForm` pre-filled from
   * whichever backend (or `undefined` for Custom) was picked. `chosenPreset`
   * is only meaningful while `addStep === "form"`.
   */
  let addStep = $state<"closed" | "choose" | "form">("closed");
  let chosenPreset = $state<ProviderPreset | undefined>(undefined);
  let editingId = $state<string | null>(null);

  /** Host-permission grants + the per-row "Test connection" flow, in the shared gate McpServersSection.svelte also uses. */
  const gate = createRegistryTestGate<ProviderTestOutcome>(permissionDeniedOutcome);

  function refreshPermissions(): Promise<void> {
    return gate.refreshGrants(providers.map((p) => ({ id: p.id, url: p.baseUrl })));
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

  async function refresh(): Promise<void> {
    const registry = optionsServices().providers;
    const [loaded, listErr] = await registry.listProviders();
    // Card 92 kept the previous list showing rather than emptying the page
    // and implying the user has no providers; card 95 puts the reason where
    // they can read it, which matters more here than on most sections — an
    // empty-looking provider list is exactly the state someone would "fix"
    // by re-adding a provider they already have.
    if (listErr) {
      failure.report(m.providersSection_loadFailedWhat(), listErr);
      return;
    }
    providers = loaded;
    const [storedDefault, defaultErr] = await registry.getDefaultSelection();
    if (defaultErr) {
      failure.report(m.providersSection_readDefaultFailedWhat(), defaultErr);
      return;
    }
    failure.clear();
    defaultSelection = storedDefault;

    // Drop model-option state for providers that no longer exist, so a
    // deleted provider can't leave a stale entry behind if it's ever
    // re-added under a reused id (mirrors selection.svelte.ts's `loadProviders`).
    defaultModels.keepOnly(new Set(providers.map((p) => p.id)));

    await Promise.all([
      refreshPermissions(),
      defaultModels.loadAll(providers),
      staleDefault.refresh(defaultSelection),
    ]);
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
    const confirmed = confirm(m.providersSection_removeConfirm({ name: provider.name }));
    if (!confirmed) return;
    const [, err] = await optionsServices().providers.removeProvider(provider.id);
    if (err)
      return failure.report(m.providersSection_removeFailedWhat({ name: provider.name }), err);
    gate.forget(provider.id);
    await refresh();
  }

  async function handleMove(index: number, direction: -1 | 1): Promise<void> {
    const next = reorderStep(providers, index, direction);
    if (!next) return;
    providers = next; // optimistic reorder while the write lands
    const [, err] = await optionsServices().providers.reorderProviders(next.map((p) => p.id));
    // The optimistic swap above already happened, so a failure here leaves
    // the list showing an order storage does not have — which is precisely
    // why card 95 says so on screen rather than in the console: `refresh()`
    // on the next mount silently puts the rows back, and a user who was not
    // told would read that as the extension forgetting their arrangement.
    if (err) failure.report(m.providersSection_reorderFailedWhat(), err);
  }

  /**
   * Card 52 (carrying forward card 41's discipline): apply the same
   * three-state capability rule the side panel's picker applies
   * (decisions/11) at the point the default is actually set, not just in the
   * UI's disabled state — ProviderRow's dropdown only ever offers
   * tool-capable models, but this re-checks `modelId` against the CURRENT
   * `defaultModels` options before writing, so a stale/in-flight reload
   * can never let a no-tools/unknown (or since-removed) model become the
   * default (the same "second guard" `selectModel` keeps in
   * src/sidepanel/stores/selection.svelte.ts).
   */
  async function handleSetDefault(provider: ProviderConfig, modelId: string): Promise<void> {
    const options = defaultModels.optionsFor(provider.id);
    if (!options.some((o) => o.model.id === modelId)) return;

    const [, err] = await optionsServices().providers.setDefaultSelection({
      providerId: provider.id,
      model: modelId,
    });
    if (err) return failure.report(m.providersSection_setDefaultFailedWhat(), err);
    defaultSelection = { providerId: provider.id, model: modelId };
    await staleDefault.refresh(defaultSelection);
  }

  /** "Test connection" for a saved row — the shared gate does the host-permission dance (decisions/09) and holds the outcome. */
  function handleTest(provider: ProviderConfig): Promise<void> {
    return gate.test({ id: provider.id, url: provider.baseUrl }, () =>
      testProviderConnection(provider),
    );
  }
</script>

<section aria-labelledby="providers-heading">
  <Card.Root>
    <Card.Header>
      <h2 id="providers-heading" class="text-base font-medium tracking-tight">
        {m.providersSection_heading()}
      </h2>
      <Card.Description>
        {m.providersSection_description()}
      </Card.Description>
    </Card.Header>

    <Card.Content class="flex flex-col gap-4">
      {#if failure.message}
        <!-- Card 95: a storage read or write this section could not complete.
             Above the list, and never INSTEAD of it — what is listed below is
             still the last thing successfully read. -->
        <Alert.Root variant="destructive">
          <Alert.Description>{failure.message}</Alert.Description>
        </Alert.Root>
      {/if}

      <Alert.Root class="bg-muted/40">
        <Alert.Description>
          {m.providersSection_credentialWarning()}
        </Alert.Description>
      </Alert.Root>

      {#if !loading && staleDefault.reason}
        <!-- Card 41's fourth checklist item: the STORED default (not merely the
             one currently displayed as selectable) is no longer valid — surface
             it clearly instead of silently letting a broken default keep
             seeding new chats. -->
        <Alert.Root variant="destructive">
          <Alert.Description>
            {m.providersSection_staleDefaultWarning({ reason: staleDefault.reason })}
          </Alert.Description>
        </Alert.Root>
      {/if}

      {#if loading}
        <p class="text-sm text-muted-foreground">{m.loadingProvidersLabel()}</p>
      {:else}
        {#if providers.length === 0 && addStep === "closed"}
          <Empty.Root class="border p-8">
            <Empty.Header>
              <Empty.Media variant="icon">
                <HugeiconsIcon icon={PlugSocketIcon} strokeWidth={2} />
              </Empty.Media>
              <Empty.Title>{m.providersSection_emptyTitle()}</Empty.Title>
              <Empty.Description>
                {m.providersSection_emptyDescription()}
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
                  permissionGranted={gate.granted[provider.id]}
                  testOutcome={gate.outcomes[provider.id]}
                  testing={gate.isTesting(provider.id)}
                  defaultModelsLoading={defaultModels.isLoading(provider.id)}
                  defaultModelOptions={defaultModels.optionsFor(provider.id).map((o) => o.model)}
                  defaultModelBlockedReason={defaultModels.blockedReason(provider.id)}
                  defaultInvalidReason={isDefault ? staleDefault.reason : undefined}
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
              {m.providers_addProviderAction()}
            </Button>
          </div>
        {/if}
      {/if}
    </Card.Content>
  </Card.Root>
</section>

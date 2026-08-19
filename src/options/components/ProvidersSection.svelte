<script lang="ts">
  // Provider registry management (card 22,
  // decisions/10-provider-registry-and-credential-storage.md): the CRUD +
  // reorder + set-default UI on top of src/lib/providers/registry.ts, which
  // already implements every storage operation this component calls —
  // nothing here talks to chrome.storage directly.
  import { onMount } from "svelte";
  import {
    addProvider,
    createProviderClient,
    getDefaultSelection,
    listProviders,
    removeProvider,
    reorderProviders,
    resolveSelection,
    setDefaultSelection,
    updateProvider,
    type ProviderConfig,
    type ProviderSelection,
  } from "../../lib/providers/registry";
  import type { ChatProvider, ModelCapabilities } from "../../lib/provider";
  import {
    isSelectable,
    reasonForCapability,
    resolveCapability,
  } from "../../lib/providers/capability";
  import { hasHostPermission, requestHostPermission } from "../lib/permissions";
  import { testProviderConnection, type TestOutcome } from "../lib/testConnection";
  import type { ProviderPreset } from "../../lib/providers/presets";
  import PresetPicker from "./PresetPicker.svelte";
  import ProviderForm from "./ProviderForm.svelte";
  import ProviderRow from "./ProviderRow.svelte";

  let providers = $state<ProviderConfig[]>([]);
  let defaultSelection = $state<ProviderSelection | undefined>(undefined);
  let loading = $state(true);

  /**
   * Card 41: whether EACH provider's own `defaultModel` field (set in
   * ProviderForm.svelte, "used when this provider is set as default") is
   * actually tool-capable — computed the same way the side panel's picker
   * computes it (src/lib/providers/capability.ts's `resolveCapability`,
   * shared rather than a second copy). `"checking"` while providers are
   * loading/reloading; `undefined` for a provider whose id hasn't been
   * checked yet. Drives whether "Set as default" is enabled for that row and
   * the inline reason shown when it isn't (decisions/11's three-state rule,
   * matched exactly).
   */
  let defaultModelChecks = $state<Record<string, ModelCapabilities | "checking" | undefined>>({});

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

  async function refreshPermissions(): Promise<void> {
    const entries = await Promise.all(
      providers.map(async (p) => [p.id, await hasHostPermission(p.baseUrl)] as const),
    );
    permissionGranted = Object.fromEntries(entries);
  }

  /** Mirrors `src/sidepanel/stores/selection.svelte.ts`'s `buildClient`: a missing factory (registry.ts: no client registered for this provider's type) is a programming-error path here, not a real `ProviderError` — `undefined` is the honest signal, never a fabricated network/auth failure. */
  function buildClient(config: ProviderConfig): ChatProvider | undefined {
    try {
      return createProviderClient(config);
    } catch {
      return undefined;
    }
  }

  /**
   * Card 41: recompute every provider's `defaultModel` capability so "Set as
   * default" can be disabled (with the picker's exact inline reason) BEFORE
   * the user clicks it, not just refused after — the same proactive
   * treatment ProviderPicker.svelte gives every row in its model list.
   */
  async function refreshDefaultModelChecks(): Promise<void> {
    defaultModelChecks = Object.fromEntries(providers.map((p) => [p.id, "checking" as const]));
    const entries = await Promise.all(
      providers.map(async (p) => {
        const model = p.defaultModel?.trim();
        if (!model) return [p.id, undefined] as const;
        const client = buildClient(p);
        if (!client) return [p.id, undefined] as const;
        return [p.id, await resolveCapability(client, { id: model, name: model })] as const;
      }),
    );
    defaultModelChecks = Object.fromEntries(entries);
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
    const resolved = await resolveSelection(defaultSelection);
    if (resolved.status !== "ok") {
      staleDefaultReason = "The provider it points to has been removed.";
      return;
    }
    const client = buildClient(resolved.config);
    if (!client) {
      staleDefaultReason = `No client is registered for provider type "${resolved.config.type}".`;
      return;
    }
    const capability = await resolveCapability(client, { id: resolved.model, name: resolved.model });
    staleDefaultReason = isSelectable(capability)
      ? undefined
      : (reasonForCapability(capability) ?? "This model can't be confirmed as tool-capable.");
  }

  async function refresh(): Promise<void> {
    providers = await listProviders();
    defaultSelection = await getDefaultSelection();
    await Promise.all([refreshPermissions(), refreshDefaultModelChecks(), refreshStaleDefault()]);
  }

  onMount(() => {
    refresh().finally(() => {
      loading = false;
    });

    // Keep the "Permission needed" / "Permission granted" badges live if the
    // user grants or revokes a host permission from chrome://extensions
    // while this page is open, not just right after a Test Connection click.
    const onPermissionsChanged = () => {
      refreshPermissions();
    };
    chrome.permissions.onAdded.addListener(onPermissionsChanged);
    chrome.permissions.onRemoved.addListener(onPermissionsChanged);
    return () => {
      chrome.permissions.onAdded.removeListener(onPermissionsChanged);
      chrome.permissions.onRemoved.removeListener(onPermissionsChanged);
    };
  });

  async function handleAddSubmit(data: Omit<ProviderConfig, "id">): Promise<void> {
    await addProvider(data);
    addStep = "closed";
    chosenPreset = undefined;
    await refresh();
  }

  async function handleEditSubmit(id: string, data: Omit<ProviderConfig, "id">): Promise<void> {
    await updateProvider(id, data);
    editingId = null;
    await refresh();
  }

  async function handleRemove(provider: ProviderConfig): Promise<void> {
    const ok = confirm(
      `Remove "${provider.name}"? Any tab session currently using it will be left with a dangling provider and prompted to pick a replacement.`,
    );
    if (!ok) return;
    await removeProvider(provider.id);
    delete testOutcomes[provider.id];
    delete permissionGranted[provider.id];
    await refresh();
  }

  async function handleMove(index: number, direction: -1 | 1): Promise<void> {
    const target = index + direction;
    if (target < 0 || target >= providers.length) return;
    const next = [...providers];
    [next[index], next[target]] = [next[target], next[index]];
    providers = next; // optimistic reorder while the write lands
    await reorderProviders(next.map((p) => p.id));
  }

  /** `defaultModelChecks[id]` narrowed to "is this actually settable" — `undefined` (no model configured, or not checked yet) and `"checking"` (still in flight) both count as not-yet-settable, same as an unresolved capability in the panel's picker. */
  function canSetDefault(check: ModelCapabilities | "checking" | undefined): boolean {
    return check !== undefined && check !== "checking" && isSelectable(check);
  }

  /**
   * The inline reason "Set as default" is disabled for `provider` right now
   * — same wording `reasonForCapability` gives the panel's picker for a
   * disabled row, or a plain "configure one first" note when there's no
   * `defaultModel` to check at all. `undefined` once the model checks out.
   */
  function setDefaultBlockedReason(provider: ProviderConfig): string | undefined {
    if (!provider.defaultModel?.trim()) {
      return "Set a default model below (Edit → Default model) before making this the default.";
    }
    const check = defaultModelChecks[provider.id];
    if (check === "checking" || check === undefined) return undefined; // still resolving — no verdict to report yet
    return isSelectable(check) ? undefined : reasonForCapability(check);
  }

  /**
   * Card 41: apply the same three-state capability rule the side panel's
   * picker applies (decisions/11) at the point the default is actually set,
   * not just in the UI's disabled state — ProviderRow's button is already
   * disabled whenever `defaultModelChecks[provider.id]` isn't settable, but
   * this re-checks before writing so a stale/in-flight check can never let a
   * no-tools/unknown model become the default (the same "second guard"
   * `selectModel` keeps in src/sidepanel/stores/selection.svelte.ts).
   */
  async function handleSetDefault(provider: ProviderConfig): Promise<void> {
    const model = provider.defaultModel?.trim();
    if (!model || !canSetDefault(defaultModelChecks[provider.id])) return;

    await setDefaultSelection({ providerId: provider.id, model });
    defaultSelection = { providerId: provider.id, model };
    await refreshStaleDefault();
  }

  /**
   * "Test connection" for a saved row — MUST call `chrome.permissions.request`
   * as the first `await` when the grant isn't already known-true
   * (decisions/09): a click handler is the only place the browser honours
   * that request, and any async work ahead of it risks losing the gesture.
   */
  async function handleTest(provider: ProviderConfig): Promise<void> {
    testingIds = { ...testingIds, [provider.id]: true };
    testOutcomes = { ...testOutcomes, [provider.id]: undefined };

    try {
      let granted = permissionGranted[provider.id];
      if (granted !== true) {
        granted = await requestHostPermission(provider.baseUrl);
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

<section class="section" aria-labelledby="providers-heading">
  <div class="section__header">
    <h2 id="providers-heading">Chat providers</h2>
    <p>
      Register the Ollama or OpenAI-compatible endpoints the side panel can chat through. Exactly
      one provider (and model) is the default the panel opens with.
    </p>
  </div>

  <p class="note">
    API keys and custom header values are stored unencrypted on this device
    (chrome.storage.local) and never synced to your Google account. Anyone with access to this
    browser profile's data can read them.
  </p>

  {#if !loading && staleDefaultReason}
    <!-- Card 41's fourth checklist item: the STORED default (not merely the
         one currently displayed as selectable) is no longer valid — surface
         it clearly instead of silently letting a broken default keep
         seeding new chats. -->
    <p class="note note--warning" role="alert">
      The default provider/model can no longer be confirmed as tool-capable: {staleDefaultReason} New
      chats seeded from it will need a different model picked in the side panel before they can use
      page tools. Pick a new default below.
    </p>
  {/if}

  {#if loading}
    <p>Loading providers…</p>
  {:else}
    {#if providers.length === 0 && addStep === "closed"}
      <div class="empty-state">
        <span class="empty-state__glyph" aria-hidden="true">🔌</span>
        <span class="empty-state__title">No providers registered yet</span>
        <p>
          Add a provider below to let the side panel connect to Ollama or an OpenAI-compatible
          endpoint. Until then, the side panel has nothing to chat through — this is separate from
          having no tool-capable models on a provider you've already added.
        </p>
      </div>
    {:else if providers.length > 0}
      <div class="provider-list">
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
              checkingDefaultModel={defaultModelChecks[provider.id] === "checking"}
              canSetDefault={canSetDefault(defaultModelChecks[provider.id])}
              setDefaultBlockedReason={setDefaultBlockedReason(provider)}
              defaultInvalidReason={isDefault ? staleDefaultReason : undefined}
              onEdit={() => (editingId = provider.id)}
              onRemove={() => handleRemove(provider)}
              onMoveUp={() => handleMove(index, -1)}
              onMoveDown={() => handleMove(index, 1)}
              onSetDefault={() => handleSetDefault(provider)}
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
      <div class="toolbar">
        <button type="button" class="btn-primary" onclick={() => (addStep = "choose")}>+ Add provider</button>
      </div>
    {/if}
  {/if}
</section>

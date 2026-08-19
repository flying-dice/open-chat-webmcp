<script lang="ts">
  // Provider registry management (card 22,
  // decisions/10-provider-registry-and-credential-storage.md): the CRUD +
  // reorder + set-default UI on top of src/lib/providers/registry.ts, which
  // already implements every storage operation this component calls —
  // nothing here talks to chrome.storage directly.
  import { onMount } from "svelte";
  import {
    addProvider,
    getDefaultSelection,
    listProviders,
    removeProvider,
    reorderProviders,
    setDefaultSelection,
    updateProvider,
    type ProviderConfig,
    type ProviderSelection,
  } from "../../lib/providers/registry";
  import { hasHostPermission, requestHostPermission } from "../lib/permissions";
  import { testProviderConnection, type TestOutcome } from "../lib/testConnection";
  import ProviderForm from "./ProviderForm.svelte";
  import ProviderRow from "./ProviderRow.svelte";

  let providers = $state<ProviderConfig[]>([]);
  let defaultSelection = $state<ProviderSelection | undefined>(undefined);
  let loading = $state(true);

  let adding = $state(false);
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

  async function refresh(): Promise<void> {
    providers = await listProviders();
    defaultSelection = await getDefaultSelection();
    await refreshPermissions();
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
    adding = false;
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

  async function handleSetDefault(provider: ProviderConfig): Promise<void> {
    await setDefaultSelection({ providerId: provider.id, model: provider.defaultModel ?? "" });
    defaultSelection = { providerId: provider.id, model: provider.defaultModel ?? "" };
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

  {#if loading}
    <p>Loading providers…</p>
  {:else}
    {#if providers.length === 0 && !adding}
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
            <ProviderRow
              {provider}
              isDefault={defaultSelection?.providerId === provider.id}
              isFirst={index === 0}
              isLast={index === providers.length - 1}
              permissionGranted={permissionGranted[provider.id]}
              testOutcome={testOutcomes[provider.id]}
              testing={testingIds[provider.id] ?? false}
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

    {#if adding}
      <ProviderForm mode="add" onSubmit={handleAddSubmit} onCancel={() => (adding = false)} />
    {:else}
      <div class="toolbar">
        <button type="button" class="btn-primary" onclick={() => (adding = true)}>+ Add provider</button>
      </div>
    {/if}
  {/if}
</section>

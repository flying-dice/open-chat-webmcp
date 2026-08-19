<script lang="ts">
  // MCP server registry management (card 39,
  // decisions/14-backend-mcp-servers.md,
  // decisions/15-custom-headers-are-credentials.md): the third options-page
  // section, mounted alongside ProvidersSection (card 22) and
  // SettingsSection (card 13) in src/options/App.svelte, on top of
  // src/lib/mcp/registry.ts — which already implements every storage
  // operation this component calls. Deliberately mirrors
  // ProvidersSection.svelte's shape (state layout, permission-badge
  // lifecycle, optimistic reorder) rather than inventing a new pattern for
  // "a list of remote-endpoint configs with add/edit/remove/reorder and a
  // test-connection flow" — this is the same kind of section, one field
  // shape different (auth+headers instead of type+apiKey+model), plus an
  // enable/disable toggle providers don't have.
  import { onMount } from "svelte";
  import {
    addServer,
    listServers,
    removeServer,
    reorderServers,
    updateServer,
    type McpServerConfig,
  } from "../../lib/mcp/registry";
  import { hasHostPermission, requestHostPermission } from "../../lib/permissions";
  import { testMcpServerConnection, type McpTestOutcome } from "../lib/mcpTestConnection";
  import McpServerForm from "./McpServerForm.svelte";
  import McpServerRow from "./McpServerRow.svelte";

  let servers = $state<McpServerConfig[]>([]);
  let loading = $state(true);

  let adding = $state(false);
  let editingId = $state<string | null>(null);

  /** `undefined` per id while its grant check is in flight — kept distinct from a settled `false` so the badge never briefly flashes "needed". */
  let permissionGranted = $state<Record<string, boolean | undefined>>({});
  let testOutcomes = $state<Record<string, McpTestOutcome | undefined>>({});
  let testingIds = $state<Record<string, boolean>>({});

  async function refreshPermissions(): Promise<void> {
    const entries = await Promise.all(
      servers.map(async (s) => [s.id, await hasHostPermission(s.url)] as const),
    );
    permissionGranted = Object.fromEntries(entries);
  }

  async function refresh(): Promise<void> {
    servers = await listServers();
    await refreshPermissions();
  }

  onMount(() => {
    refresh().finally(() => {
      loading = false;
    });

    // Keep the "Permission needed" / "Permission granted" badges live if the
    // user grants or revokes a host permission from chrome://extensions
    // while this page is open, not just right after a Test Connection click
    // (mirrors ProvidersSection.svelte).
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

  async function handleAddSubmit(data: Omit<McpServerConfig, "id">): Promise<void> {
    await addServer(data);
    adding = false;
    await refresh();
  }

  async function handleEditSubmit(id: string, data: Omit<McpServerConfig, "id">): Promise<void> {
    await updateServer(id, data);
    editingId = null;
    await refresh();
  }

  async function handleRemove(server: McpServerConfig): Promise<void> {
    const ok = confirm(
      `Remove "${server.name}"? Its tools will no longer be offered to the model, and its stored token and headers will be deleted.`,
    );
    if (!ok) return;
    await removeServer(server.id);
    delete testOutcomes[server.id];
    delete permissionGranted[server.id];
    await refresh();
  }

  async function handleToggleEnabled(server: McpServerConfig): Promise<void> {
    await updateServer(server.id, { enabled: !server.enabled });
    await refresh();
  }

  async function handleMove(index: number, direction: -1 | 1): Promise<void> {
    const target = index + direction;
    if (target < 0 || target >= servers.length) return;
    const next = [...servers];
    [next[index], next[target]] = [next[target], next[index]];
    servers = next; // optimistic reorder while the write lands
    await reorderServers(next.map((s) => s.id));
  }

  /**
   * "Test connection" for a saved row — MUST call `chrome.permissions.request`
   * as the first `await` when the grant isn't already known-true
   * (decisions/14): a click handler is the only place the browser honours
   * that request, and any async work ahead of it risks losing the gesture.
   */
  async function handleTest(server: McpServerConfig): Promise<void> {
    testingIds = { ...testingIds, [server.id]: true };
    testOutcomes = { ...testOutcomes, [server.id]: undefined };

    try {
      let granted = permissionGranted[server.id];
      if (granted !== true) {
        granted = await requestHostPermission(server.url);
        permissionGranted = { ...permissionGranted, [server.id]: granted };
        if (!granted) {
          testOutcomes = {
            ...testOutcomes,
            [server.id]: {
              kind: "permission-denied",
              message:
                "This extension doesn't have permission to contact this host. Grant it when Chrome prompts, or from chrome://extensions, then try again.",
            },
          };
          return;
        }
      }
      testOutcomes = { ...testOutcomes, [server.id]: await testMcpServerConnection(server) };
    } finally {
      testingIds = { ...testingIds, [server.id]: false };
    }
  }
</script>

<section class="section" aria-labelledby="mcp-servers-heading">
  <div class="section__header">
    <h2 id="mcp-servers-heading">MCP servers</h2>
    <p>
      An MCP server exposes tools the model can call that have nothing to do with the current page
      — a ticket tracker, a search index, an internal service. Its tools are merged into the same
      list the page's own tools appear in, namespaced by server so nothing collides, and the same
      approval policy applies to them.
    </p>
  </div>

  <p class="note">
    The bearer token and custom header values you set below are stored unencrypted on this device
    (chrome.storage.local) and never synced to your Google account. Anyone with access to this
    browser profile's data can read them.
  </p>

  {#if loading}
    <p>Loading MCP servers…</p>
  {:else}
    {#if servers.length === 0 && !adding}
      <div class="empty-state">
        <span class="empty-state__glyph" aria-hidden="true">🛠️</span>
        <span class="empty-state__title">No MCP servers registered yet</span>
        <p>
          Only remote HTTP/SSE MCP servers are supported here — this extension can't spawn or
          speak to a local stdio process the way a desktop MCP client can. To reach a stdio-only
          server, put an off-the-shelf stdio-to-HTTP proxy in front of it and add the proxy's URL
          below instead.
        </p>
      </div>
    {:else if servers.length > 0}
      <div class="provider-list">
        {#each servers as server, index (server.id)}
          {#if editingId === server.id}
            <McpServerForm
              mode="edit"
              initial={server}
              onSubmit={(data) => handleEditSubmit(server.id, data)}
              onCancel={() => (editingId = null)}
            />
          {:else}
            <McpServerRow
              {server}
              isFirst={index === 0}
              isLast={index === servers.length - 1}
              permissionGranted={permissionGranted[server.id]}
              testOutcome={testOutcomes[server.id]}
              testing={testingIds[server.id] ?? false}
              onEdit={() => (editingId = server.id)}
              onRemove={() => handleRemove(server)}
              onMoveUp={() => handleMove(index, -1)}
              onMoveDown={() => handleMove(index, 1)}
              onToggleEnabled={() => handleToggleEnabled(server)}
              onTest={() => handleTest(server)}
            />
          {/if}
        {/each}
      </div>
    {/if}

    {#if adding}
      <McpServerForm mode="add" onSubmit={handleAddSubmit} onCancel={() => (adding = false)} />
    {:else}
      <div class="toolbar">
        <button type="button" class="btn-primary" onclick={() => (adding = true)}>+ Add MCP server</button>
      </div>
    {/if}
  {/if}
</section>

<script lang="ts">
  // MCP server registry management (card 39,
  // decisions/14-backend-mcp-servers.md,
  // decisions/15-custom-headers-are-credentials.md): the third options-page
  // section, mounted alongside ProvidersSection (card 22) and
  // SettingsSection (card 13) in src/options/App.svelte, on top of
  // the `McpServerRegistry` port — which already implements every storage
  // operation this component calls. Deliberately mirrors
  // ProvidersSection.svelte's shape (state layout, permission-badge
  // lifecycle, optimistic reorder) rather than inventing a new pattern for
  // "a list of remote-endpoint configs with add/edit/remove/reorder and a
  // test-connection flow" — this is the same kind of section, one field
  // shape different (auth+headers instead of type+apiKey+model), plus an
  // enable/disable toggle providers don't have.
  //
  // Card 71 (decisions/28-shadcn-svelte-maia-zinc.md): same shadcn
  // Card/Alert/Empty/Button shell ProvidersSection got, kept in step with it
  // for the same reason the state layout is.
  import { onMount } from "svelte";
  import type { McpServerConfig } from "../../domain/tools";
  import { optionsServices } from "../app-services";
  import { testMcpServerConnection, type McpTestOutcome } from "../lib/mcpTestConnection";
  import McpServerForm from "./McpServerForm.svelte";
  import McpServerRow from "./McpServerRow.svelte";
  import * as Alert from "$lib/components/ui/alert";
  import * as Card from "$lib/components/ui/card";
  import * as Empty from "$lib/components/ui/empty";
  import { Button } from "$lib/components/ui/button";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { PlusSignIcon, Wrench01Icon } from "@hugeicons/core-free-icons";

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
      servers.map(async (s) => [s.id, await optionsServices().permissions.has(s.url)] as const),
    );
    permissionGranted = Object.fromEntries(entries);
  }

  async function refresh(): Promise<void> {
    servers = await optionsServices().mcpServers.listServers();
    await refreshPermissions();
  }

  onMount(() => {
    refresh().finally(() => {
      loading = false;
    });

    // Keep the "Permission needed" / "Permission granted" badges live if the
    // user grants or revokes a host permission from chrome://extensions
    // while this page is open, not just right after a Test Connection click
    // (mirrors ProvidersSection.svelte, including card 78's move of the
    // `onAdded`/`onRemoved` pair behind the `HostPermissions` port).
    return optionsServices().permissions.onChanged(() => {
      refreshPermissions();
    });
  });

  async function handleAddSubmit(data: Omit<McpServerConfig, "id">): Promise<void> {
    await optionsServices().mcpServers.addServer(data);
    adding = false;
    await refresh();
  }

  async function handleEditSubmit(id: string, data: Omit<McpServerConfig, "id">): Promise<void> {
    await optionsServices().mcpServers.updateServer(id, data);
    editingId = null;
    await refresh();
  }

  async function handleRemove(server: McpServerConfig): Promise<void> {
    const ok = confirm(
      `Remove "${server.name}"? Its tools will no longer be offered to the model, and its stored token and headers will be deleted.`,
    );
    if (!ok) return;
    await optionsServices().mcpServers.removeServer(server.id);
    delete testOutcomes[server.id];
    delete permissionGranted[server.id];
    await refresh();
  }

  async function handleToggleEnabled(server: McpServerConfig): Promise<void> {
    await optionsServices().mcpServers.updateServer(server.id, { enabled: !server.enabled });
    await refresh();
  }

  async function handleMove(index: number, direction: -1 | 1): Promise<void> {
    const target = index + direction;
    if (target < 0 || target >= servers.length) return;
    const next = [...servers];
    [next[index], next[target]] = [next[target], next[index]];
    servers = next; // optimistic reorder while the write lands
    await optionsServices().mcpServers.reorderServers(next.map((s) => s.id));
  }

  /**
   * "Test connection" for a saved row — MUST call `permissions.request`
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
        granted = await optionsServices().permissions.request(server.url);
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

<section aria-labelledby="mcp-servers-heading">
  <Card.Root>
    <Card.Header>
      <h2 id="mcp-servers-heading" class="text-base font-medium">MCP servers</h2>
      <Card.Description>
        An MCP server exposes tools the model can call that have nothing to do with the current page
        — a ticket tracker, a search index, an internal service. Its tools are merged into the same
        list the page's own tools appear in, namespaced by server so nothing collides — but a server
        tool call is judged by its own, separate, stricter approval policy, not the page's
        (decisions/20-approval-policy-is-per-tool-source.md). See "MCP server tool approval" above.
      </Card.Description>
    </Card.Header>

    <Card.Content class="flex flex-col gap-4">
      <Alert.Root class="bg-muted/40">
        <Alert.Description>
          The bearer token and custom header values you set below are stored unencrypted on this
          device (chrome.storage.local) and never synced to your Google account. Anyone with access
          to this browser profile's data can read them.
        </Alert.Description>
      </Alert.Root>

      {#if loading}
        <p class="text-sm text-muted-foreground">Loading MCP servers…</p>
      {:else}
        {#if servers.length === 0 && !adding}
          <Empty.Root class="border p-8">
            <Empty.Header>
              <Empty.Media variant="icon">
                <HugeiconsIcon icon={Wrench01Icon} strokeWidth={2} />
              </Empty.Media>
              <Empty.Title>No MCP servers registered yet</Empty.Title>
              <Empty.Description>
                Only remote HTTP/SSE MCP servers are supported here — this extension can't spawn or
                speak to a local stdio process the way a desktop MCP client can. To reach a
                stdio-only server, put an off-the-shelf stdio-to-HTTP proxy in front of it and add
                the proxy's URL below instead.
              </Empty.Description>
            </Empty.Header>
          </Empty.Root>
        {:else if servers.length > 0}
          <div class="flex flex-col gap-2">
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
          <div class="flex justify-end">
            <Button onclick={() => (adding = true)}>
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} data-icon="inline-start" />
              Add MCP server
            </Button>
          </div>
        {/if}
      {/if}
    </Card.Content>
  </Card.Root>
</section>

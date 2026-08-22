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
  import { fail, ok, type Result } from "../../domain/result";
  import type { StorageError } from "../../domain/storage";
  import type { McpServerConfig } from "../../domain/tools";
  import { storageFailureMessage } from "../../ui/storageMessage";
  import { optionsServices } from "../app-services";
  import { testMcpServerConnection, type McpTestOutcome } from "../forms/mcpTestConnection";
  import { m } from "../../paraglide/messages.js";
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
  /** Card 95: this section's storage-failure line — mirrors ProvidersSection.svelte's, for the same reasons. Form saves report into McpServerForm.svelte instead. */
  let failure = $state<string | undefined>(undefined);

  let adding = $state(false);
  let editingId = $state<string | null>(null);

  /** `undefined` per id while its grant check is in flight — kept distinct from a settled `false` so the badge never briefly flashes "needed". */
  let permissionGranted = $state<Record<string, boolean | undefined>>({});
  let testOutcomes = $state<Record<string, McpTestOutcome | undefined>>({});
  let testingIds = $state<Record<string, boolean>>({});

  // TODO: clean-code - 0.45 - DRY: refreshPermissions (Promise.all + Object.fromEntries over cached grants) and handleMove/handleTest below are the same generic reorder/permission-gate plumbing duplicated a second time in ProvidersSection.svelte, with no domain-specific reason left to be typed twice.
  async function refreshPermissions(): Promise<void> {
    const entries = await Promise.all(
      servers.map(async (s) => [s.id, await optionsServices().permissions.has(s.url)] as const),
    );
    permissionGranted = Object.fromEntries(entries);
  }

  async function refresh(): Promise<void> {
    const [loaded, err] = await optionsServices().mcpServers.listServers();
    // Card 92 kept the previous list showing rather than blanking it on a
    // failed read; card 95 says why it may be stale. Blanking would read as
    // "your servers are gone", which is a worse lie here than anywhere else
    // on this page — these rows carry stored tokens.
    if (err) {
      failure = storageFailureMessage(m.mcpServersSection_loadFailedWhat(), err);
      return;
    }
    failure = undefined;
    servers = loaded;
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

  /** Card 92 — see ProvidersSection.svelte's twin: a write that failed must not be followed by the UI change that assumed it landed. Card 95 turns each one into a line the user can actually read, except the two FORM writes, which report inside the still-open form. */
  // TODO: clean-code - 0.35 - DRY: the whole card-95 write-failure protocol is duplicated between this section and ProvidersSection.svelte — a `failure` state field, this `reportWriteFailure(what, cause)` helper, and `handleAddSubmit`/`handleEditSubmit` typed `Promise<Result<void, StorageError>>` so the paired form (McpServerForm.svelte) can render the message under its own fields. Same shape as the four DRY markers this file pair already carries; new with the errors-as-values migration (card 96's audit), and the same decisions/20 caution applies — an extraction must not let an edit to one section silently change the other.
  function reportWriteFailure(what: string, cause: StorageError): void {
    failure = storageFailureMessage(what, cause);
  }

  async function handleAddSubmit(
    data: Omit<McpServerConfig, "id">,
  ): Promise<Result<void, StorageError>> {
    const [, err] = await optionsServices().mcpServers.addServer(data);
    if (err) return fail(err);
    adding = false;
    await refresh();
    return ok();
  }

  async function handleEditSubmit(
    id: string,
    data: Omit<McpServerConfig, "id">,
  ): Promise<Result<void, StorageError>> {
    const [, err] = await optionsServices().mcpServers.updateServer(id, data);
    if (err) return fail(err);
    editingId = null;
    await refresh();
    return ok();
  }

  async function handleRemove(server: McpServerConfig): Promise<void> {
    const confirmed = confirm(m.mcpServersSection_removeConfirm({ name: server.name }));
    if (!confirmed) return;
    const [, err] = await optionsServices().mcpServers.removeServer(server.id);
    if (err)
      return reportWriteFailure(m.mcpServersSection_removeFailedWhat({ name: server.name }), err);
    delete testOutcomes[server.id];
    delete permissionGranted[server.id];
    await refresh();
  }

  async function handleToggleEnabled(server: McpServerConfig): Promise<void> {
    const [, err] = await optionsServices().mcpServers.updateServer(server.id, {
      enabled: !server.enabled,
    });
    // The row's toggle reads from `servers`, which `refresh()` below rewrites
    // — so a failed write leaves the switch where it was, and this line is
    // the only thing that distinguishes that from a click that missed.
    if (err) {
      return reportWriteFailure(
        server.enabled
          ? m.mcpServersSection_turnOffFailedWhat({ name: server.name })
          : m.mcpServersSection_turnOnFailedWhat({ name: server.name }),
        err,
      );
    }
    await refresh();
  }

  // TODO: clean-code - 0.45 - DRY: byte-identical optimistic-reorder-then-persist logic to ProvidersSection.svelte's handleMove.
  async function handleMove(index: number, direction: -1 | 1): Promise<void> {
    const target = index + direction;
    if (target < 0 || target >= servers.length) return;
    const current = servers[index];
    const swapped = servers[target];
    if (!current || !swapped) return; // both indices are in-range, checked above — this can't actually miss
    const next = [...servers];
    next[index] = swapped;
    next[target] = current;
    servers = next; // optimistic reorder while the write lands
    const [, err] = await optionsServices().mcpServers.reorderServers(next.map((s) => s.id));
    // Same as ProvidersSection's twin: the optimistic swap already happened,
    // so a failure leaves the list ahead of storage until the next refresh.
    if (err) reportWriteFailure(m.mcpServersSection_reorderFailedWhat(), err);
  }

  /**
   * "Test connection" for a saved row — MUST call `permissions.request`
   * as the first `await` when the grant isn't already known-true
   * (decisions/14): a click handler is the only place the browser honours
   * that request, and any async work ahead of it risks losing the gesture.
   */
  // TODO: clean-code - 0.45 - DRY: the "check cached grant -> permissions.request as first await -> run the test, else report the same permission-denied string" flow duplicates ProvidersSection.svelte's handleTest.
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
              message: m.permissionDeniedRetryMessage(),
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
      <h2 id="mcp-servers-heading" class="text-base font-medium tracking-tight">
        {m.mcpServersSection_heading()}
      </h2>
      <Card.Description>
        {m.mcpServersSection_description()}
      </Card.Description>
    </Card.Header>

    <Card.Content class="flex flex-col gap-4">
      {#if failure}
        <Alert.Root variant="destructive">
          <Alert.Description>{failure}</Alert.Description>
        </Alert.Root>
      {/if}

      <Alert.Root class="bg-muted/40">
        <Alert.Description>
          {m.mcpServersSection_credentialWarning()}
        </Alert.Description>
      </Alert.Root>

      {#if loading}
        <p class="text-sm text-muted-foreground">{m.mcpServersSection_loadingLabel()}</p>
      {:else}
        {#if servers.length === 0 && !adding}
          <Empty.Root class="border p-8">
            <Empty.Header>
              <Empty.Media variant="icon">
                <HugeiconsIcon icon={Wrench01Icon} strokeWidth={2} />
              </Empty.Media>
              <Empty.Title>{m.mcpServersSection_emptyTitle()}</Empty.Title>
              <Empty.Description>
                {m.mcpServersSection_emptyDescription()}
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
              {m.mcpServersSection_addAction()}
            </Button>
          </div>
        {/if}
      {/if}
    </Card.Content>
  </Card.Root>
</section>

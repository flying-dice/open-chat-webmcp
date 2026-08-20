<script lang="ts">
  // One row in the MCP server list (card 39). Purely presentational — all
  // storage mutation and the permission/test-connection flow live in the
  // parent (McpServersSection.svelte), passed in as callbacks — mirrors
  // ProviderRow.svelte's split for the same reason.
  import type { McpServerConfig } from "../../lib/mcp/registry";
  import type { McpTestOutcome } from "../lib/mcpTestConnection";
  import { testResultClass, testResultMessage, testResultTools } from "../lib/mcpTestResultDisplay";

  interface Props {
    server: McpServerConfig;
    isFirst: boolean;
    isLast: boolean;
    /** `undefined` while the grant check is still in flight, distinct from a settled `true`/`false`. */
    permissionGranted: boolean | undefined;
    testOutcome: McpTestOutcome | undefined;
    testing: boolean;
    onEdit: () => void;
    onRemove: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onToggleEnabled: () => void;
    onTest: () => void;
  }

  let {
    server,
    isFirst,
    isLast,
    permissionGranted,
    testOutcome,
    testing,
    onEdit,
    onRemove,
    onMoveUp,
    onMoveDown,
    onToggleEnabled,
    onTest,
  }: Props = $props();

  const headerCount = $derived(Object.keys(server.headers ?? {}).length);

  let toolsExpanded = $state(false);
</script>

<div class="provider-row" class:provider-row--disabled={!server.enabled}>
  <div class="provider-row__top">
    <div class="provider-row__order">
      <button class="icon-btn" type="button" onclick={onMoveUp} disabled={isFirst} aria-label={`Move ${server.name} up`}>
        ▲
      </button>
      <button class="icon-btn" type="button" onclick={onMoveDown} disabled={isLast} aria-label={`Move ${server.name} down`}>
        ▼
      </button>
    </div>

    <div>
      <div class="provider-row__name">{server.name}</div>
      <div class="provider-row__url">{server.url}</div>
    </div>

    {#if !server.enabled}
      <span class="badge" title="Disabled servers contribute no tools and their host permission is not requested.">
        Disabled
      </span>
    {/if}
    {#if server.auth?.type === "bearer" && server.auth.token}
      <span class="badge" title="A bearer token is configured — masked here, open Edit to view or change it.">
        Bearer token
      </span>
    {/if}
    <!--
      Card 62 widened McpServerAuth to a bearer/oauth union. Card 63 (this
      badge): a best-known-state indicator checked against the stored
      config's `expiresAt`/`refreshToken` on render — NOT a live network
      probe (decisions/27's consequences: "the management UI ... needs a way
      to show 'reconnect needed' distinctly from 'add a token'").
    -->
    {#if server.auth?.type === "oauth" && server.auth.expiresAt !== undefined && server.auth.expiresAt <= Date.now() && !server.auth.refreshToken}
      <span
        class="badge badge--danger"
        title="This server's OAuth token has expired and there's no refresh token to renew it automatically — open Edit and sign in again."
      >
        Reconnect needed
      </span>
    {/if}

    {#if headerCount > 0}
      <span
        class="provider-row__headers"
        title="Header values are masked here — open Edit to view or change them."
      >
        {headerCount} custom header{headerCount === 1 ? "" : "s"}
      </span>
    {/if}
    {#if permissionGranted === false}
      <span
        class="badge badge--danger"
        title="This extension hasn't been granted permission to contact this host — it will never connect until you grant it."
      >
        Permission needed
      </span>
    {:else if permissionGranted === true}
      <span class="badge" title="This extension can contact this host.">Permission granted</span>
    {/if}

    <div class="provider-row__actions">
      <button type="button" onclick={onTest} disabled={testing}>
        {testing ? "Testing…" : "Test connection"}
      </button>
      <button type="button" onclick={onToggleEnabled}>{server.enabled ? "Disable" : "Enable"}</button>
      <button type="button" onclick={onEdit}>Edit</button>
      <button type="button" onclick={onRemove}>Remove</button>
    </div>
  </div>

  {#if testOutcome}
    <p class={`test-result ${testResultClass(testOutcome)}`}>{testResultMessage(testOutcome)}</p>
    {#if testResultTools(testOutcome)}
      {@const tools = testResultTools(testOutcome) ?? []}
      <button type="button" class="btn-plain" onclick={() => (toolsExpanded = !toolsExpanded)}>
        {toolsExpanded ? "Hide" : "Show"} {tools.length} tool{tools.length === 1 ? "" : "s"}
      </button>
      {#if toolsExpanded}
        <ul class="mcp-tool-list">
          <!-- Keyed by index, not `tool.name` — see McpServerForm.svelte's
               matching list for why: a raw, un-deduplicated server tool list
               can have colliding display names (confirmed against GitHub's
               real MCP server, which crashed this exact block otherwise). -->
          {#each tools as tool, i (i)}
            <li><code>{tool.name}</code>{#if tool.description}<span> — {tool.description}</span>{/if}</li>
          {/each}
        </ul>
      {/if}
    {/if}
  {/if}
</div>

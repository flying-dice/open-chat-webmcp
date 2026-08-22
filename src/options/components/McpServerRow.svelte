<script lang="ts">
  // One row in the MCP server list (card 39). Purely presentational — all
  // storage mutation and the permission/test-connection flow live in the
  // parent (McpServersSection.svelte), passed in as callbacks — mirrors
  // ProviderRow.svelte's split for the same reason.
  //
  // Card 71 (decisions/28-shadcn-svelte-maia-zinc.md): same shadcn
  // Badge/Button treatment ProviderRow.svelte got, kept deliberately
  // identical so the two registries still read as the same kind of list.
  // Card 113 made that literal: the wrapper, the reorder pair, the
  // header-count line and the permission badges are ./RegistryRow.svelte
  // now, and what is left below is only what an MCP server row says that a
  // provider row does not.
  import { oauthNeedsReconnect, type McpServerConfig } from "../../domain/tools";
  import type { McpTestOutcome } from "../forms/mcpTestConnection";
  import { m } from "../../paraglide/messages.js";
  import McpTestResult from "./McpTestResult.svelte";
  import RegistryRow from "./RegistryRow.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";

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
</script>

<RegistryRow
  name={server.name}
  url={server.url}
  {isFirst}
  {isLast}
  {onMoveUp}
  {onMoveDown}
  moveUpLabel={m.mcpServerRow_moveUpAriaLabel({ name: server.name })}
  moveDownLabel={m.mcpServerRow_moveDownAriaLabel({ name: server.name })}
  {permissionGranted}
  {headerCount}
  dimmed={!server.enabled}
>
  {#snippet badges()}
    {#if !server.enabled}
      <Badge variant="outline" title={m.mcpServerRow_disabledTitle()}>
        {m.mcpServerRow_disabledBadge()}
      </Badge>
    {/if}
    {#if server.auth?.type === "bearer" && server.auth.token}
      <Badge variant="outline" title={m.mcpServerRow_bearerTokenTitle()}>
        {m.bearerTokenLabel()}
      </Badge>
    {/if}
    <!--
      Card 62 widened McpServerAuth to a bearer/oauth union. Card 63 (this
      badge): a best-known-state indicator checked against the stored
      config's `expiresAt`/`refreshToken` on render — NOT a live network
      probe (decisions/27's consequences: "the management UI ... needs a way
      to show 'reconnect needed' distinctly from 'add a token'"). The rule
      itself is src/domain/tools's `oauthNeedsReconnect` (card 113), shared
      with the form's own status line so the two can never disagree.
    -->
    {#if oauthNeedsReconnect(server.auth)}
      <Badge variant="destructive" title={m.mcpServerRow_reconnectNeededTitle()}>
        {m.mcpServerRow_reconnectNeededBadge()}
      </Badge>
    {/if}
  {/snippet}

  {#snippet actions()}
    <Button variant="outline" size="sm" onclick={onTest} disabled={testing}>
      {testing ? m.testingLabel() : m.testConnectionAction()}
    </Button>
    <Button variant="outline" size="sm" onclick={onToggleEnabled}>
      {server.enabled ? m.disableAction() : m.enableAction()}
    </Button>
    <Button variant="outline" size="sm" onclick={onEdit}>{m.editAction()}</Button>
    <Button variant="outline" size="sm" onclick={onRemove}>{m.removeAction()}</Button>
  {/snippet}

  <McpTestResult outcome={testOutcome} />
</RegistryRow>

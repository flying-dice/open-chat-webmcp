<script lang="ts">
  // One row in the MCP server list (card 39). Purely presentational — all
  // storage mutation and the permission/test-connection flow live in the
  // parent (McpServersSection.svelte), passed in as callbacks — mirrors
  // ProviderRow.svelte's split for the same reason.
  //
  // Card 71 (decisions/28-shadcn-svelte-maia-zinc.md): same shadcn
  // Badge/Button treatment ProviderRow.svelte got, kept deliberately
  // identical so the two registries still read as the same kind of list.
  import type { McpServerConfig } from "../../domain/tools";
  import type { McpTestOutcome } from "../lib/mcpTestConnection";
  import { testResultClass, testResultMessage, testResultTools } from "../lib/mcpTestResultDisplay";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";

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

<div class="flex flex-col gap-2 rounded-2xl border p-3" class:opacity-60={!server.enabled}>
  <div class="flex flex-wrap items-center gap-2">
    <div class="flex flex-col gap-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        onclick={onMoveUp}
        disabled={isFirst}
        aria-label={`Move ${server.name} up`}
      >
        <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onclick={onMoveDown}
        disabled={isLast}
        aria-label={`Move ${server.name} down`}
      >
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
      </Button>
    </div>

    <div class="min-w-0">
      <div class="font-semibold">{server.name}</div>
      <div class="text-xs break-all text-muted-foreground">{server.url}</div>
    </div>

    {#if !server.enabled}
      <Badge
        variant="outline"
        title="Disabled servers contribute no tools and their host permission is not requested."
      >
        Disabled
      </Badge>
    {/if}
    {#if server.auth?.type === "bearer" && server.auth.token}
      <Badge
        variant="outline"
        title="A bearer token is configured — masked here, open Edit to view or change it."
      >
        Bearer token
      </Badge>
    {/if}
    <!--
      Card 62 widened McpServerAuth to a bearer/oauth union. Card 63 (this
      badge): a best-known-state indicator checked against the stored
      config's `expiresAt`/`refreshToken` on render — NOT a live network
      probe (decisions/27's consequences: "the management UI ... needs a way
      to show 'reconnect needed' distinctly from 'add a token'").
    -->
    {#if server.auth?.type === "oauth" && server.auth.expiresAt !== undefined && server.auth.expiresAt <= Date.now() && !server.auth.refreshToken}
      <Badge
        variant="destructive"
        title="This server's OAuth token has expired and there's no refresh token to renew it automatically — open Edit and sign in again."
      >
        Reconnect needed
      </Badge>
    {/if}

    {#if headerCount > 0}
      <span
        class="text-xs text-muted-foreground"
        title="Header values are masked here — open Edit to view or change them."
      >
        {headerCount} custom header{headerCount === 1 ? "" : "s"}
      </span>
    {/if}
    {#if permissionGranted === false}
      <Badge
        variant="destructive"
        title="This extension hasn't been granted permission to contact this host — it will never connect until you grant it."
      >
        Permission needed
      </Badge>
    {:else if permissionGranted === true}
      <Badge variant="outline" title="This extension can contact this host.">Permission granted</Badge>
    {/if}

    <div class="ml-auto flex flex-wrap items-center gap-1">
      <Button variant="outline" size="sm" onclick={onTest} disabled={testing}>
        {testing ? "Testing…" : "Test connection"}
      </Button>
      <Button variant="outline" size="sm" onclick={onToggleEnabled}>
        {server.enabled ? "Disable" : "Enable"}
      </Button>
      <Button variant="outline" size="sm" onclick={onEdit}>Edit</Button>
      <Button variant="outline" size="sm" onclick={onRemove}>Remove</Button>
    </div>
  </div>

  {#if testOutcome}
    <p class={testResultClass(testOutcome)}>{testResultMessage(testOutcome)}</p>
    {#if testResultTools(testOutcome)}
      {@const tools = testResultTools(testOutcome) ?? []}
      <div class="flex">
        <Button variant="ghost" size="sm" onclick={() => (toolsExpanded = !toolsExpanded)}>
          {toolsExpanded ? "Hide" : "Show"}
          {tools.length} tool{tools.length === 1 ? "" : "s"}
        </Button>
      </div>
      {#if toolsExpanded}
        <ul class="flex list-disc flex-col gap-0.5 pl-6 text-xs text-muted-foreground">
          <!-- Keyed by index, not `tool.name` — see McpServerForm.svelte's
               matching list for why: a raw, un-deduplicated server tool list
               can have colliding display names (confirmed against GitHub's
               real MCP server, which crashed this exact block otherwise). -->
          {#each tools as tool, i (i)}
            <li>
              <code class="font-mono text-foreground">{tool.name}</code>{#if tool.description}<span
                >
                  — {tool.description}</span
                >{/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  {/if}
</div>

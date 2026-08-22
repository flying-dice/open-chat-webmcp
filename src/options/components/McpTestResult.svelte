<script lang="ts">
  // How ONE "Test connection" outcome reads for an MCP server (card 39): the
  // banner sentence, plus — on a success that found tools — a collapsed
  // "Show N tools" disclosure over the discovered list.
  //
  // Card 81 extracted this from McpServerRow.svelte and McpServerForm.svelte,
  // which carried the same markup twice, verbatim down to the
  // `each_key_duplicate` war story below. Testing a saved row and testing a
  // draft in the form are the same reading of the same outcome type, so they
  // are now literally the same component rather than two copies that have to
  // be kept in step by hand — the same argument testResultDisplay.ts makes for
  // sharing the wording those two call sites display.
  //
  // Rendered UNCONDITIONALLY by both parents (the `{#if outcome}` lives here,
  // not in them) so that the disclosure state below survives a re-test: a
  // parent clears `testOutcome` to `undefined` before awaiting the new result,
  // and unmounting this component on that gap would silently collapse a list
  // the user had expanded.
  import type { McpTestOutcome } from "../forms/mcpTestConnection";
  import {
    mcpTestResultClass,
    mcpTestResultMessage,
    mcpTestResultTools,
  } from "../forms/testResultDisplay";
  import { Button } from "$lib/components/ui/button";

  interface Props {
    /** `undefined` before the first test, and while one is in flight — renders nothing. */
    outcome: McpTestOutcome | undefined;
  }

  let { outcome }: Props = $props();

  const tools = $derived(outcome ? mcpTestResultTools(outcome) : undefined);

  let toolsExpanded = $state(false);
</script>

{#if outcome}
  <p class={mcpTestResultClass(outcome)}>{mcpTestResultMessage(outcome)}</p>
  {#if tools}
    <div class="flex">
      <Button variant="ghost" size="sm" onclick={() => (toolsExpanded = !toolsExpanded)}>
        {toolsExpanded ? "Hide" : "Show"}
        {tools.length} tool{tools.length === 1 ? "" : "s"}
      </Button>
    </div>
    {#if toolsExpanded}
      <ul class="flex list-disc flex-col gap-0.5 pl-6 text-xs text-muted-foreground">
        <!-- Keyed by index, not `tool.name`: this is a raw server-reported
             list, un-deduplicated (unlike the sidepanel's merged tool list,
             which `buildServerMergedTools` — src/domain/tools/merge.ts —
             disambiguates). A real server can report two tools whose
             `title ?? name` fallback collides (confirmed against GitHub's
             MCP server, which crashed this exact `{#each}` with Svelte's
             `each_key_duplicate` error before this fix) — index is always
             unique for a wholesale-replaced, non-reorderable snapshot list
             like this one. -->
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

<script lang="ts">
  /**
   * Call Log view (card 11): every tool call the model made this session —
   * args, result or error, duration, and whether it ran automatically, was
   * approved, or was denied (decisions/05's accountability surface). Reads
   * `panel.toolCalls`, the same entries `logToolCall`/`completeToolCall`
   * (src/lib/session.ts) write via panel.svelte.ts's `addToolCall`/
   * `updateToolCallResult` — this is a read-only view over that log, never
   * a second copy of it.
   *
   * Rendered newest-first: the call someone just made (or just got denied)
   * is the one worth seeing without scrolling.
   *
   * Card 69 (decisions/28-shadcn-svelte-maia-zinc.md): scoped CSS replaced
   * with Tailwind utilities. The panel itself no longer owns scrolling —
   * Inspector.svelte's ScrollArea wraps whichever tab is active.
   */
  import type { ToolCallLogEntry } from "../stores/panel.svelte";
  import CallLogEntry from "./CallLogEntry.svelte";

  interface Props {
    toolCalls: ToolCallLogEntry[];
  }

  let { toolCalls }: Props = $props();

  const newestFirst = $derived([...toolCalls].reverse());
</script>

<div class="min-w-0">
  {#if toolCalls.length === 0}
    <p class="m-0 text-sm text-muted-foreground">
      No tool calls yet in this conversation. Calls the model makes on this
      page's tools will show up here as they happen — including any that get
      denied.
    </p>
  {:else}
    <ul class="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
      {#each newestFirst as entry (entry.id)}
        <li><CallLogEntry {entry} /></li>
      {/each}
    </ul>
  {/if}
</div>

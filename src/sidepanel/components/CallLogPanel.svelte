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
   */
  import type { ToolCallLogEntry } from "../stores/panel.svelte";
  import CallLogEntry from "./CallLogEntry.svelte";

  interface Props {
    toolCalls: ToolCallLogEntry[];
  }

  let { toolCalls }: Props = $props();

  const newestFirst = $derived([...toolCalls].reverse());
</script>

<div class="call-log">
  {#if toolCalls.length === 0}
    <p class="empty text-small">
      No tool calls yet in this conversation. Calls the model makes on this
      page's tools will show up here as they happen — including any that get
      denied.
    </p>
  {:else}
    <ul class="log-list">
      {#each newestFirst as entry (entry.id)}
        <li><CallLogEntry {entry} /></li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .call-log {
    min-width: 0;
  }

  .empty {
    margin: 0;
  }

  .log-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
</style>

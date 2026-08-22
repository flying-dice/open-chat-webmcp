<script lang="ts">
  /**
   * Top-level "arguments" display for a tool call (card 09) — used by both
   * ApprovalCard.svelte (before the call runs, the one moment a user can
   * catch a hallucinated or dangerous parameter) and CallLogEntry.svelte's
   * expanded view (after, for the record). Deliberately NOT a
   * `JSON.stringify`'d blob: every top-level argument gets its own labeled
   * row, formatted by ToolArgValue.svelte, which recurses into nested
   * objects/arrays with indentation rather than flattening them into one
   * hard-to-scan line.
   *
   * Card 69 (decisions/28-shadcn-svelte-maia-zinc.md): scoped CSS replaced
   * with Tailwind utilities; no behavioural change, deep structures still
   * render in full (never truncated).
   */
  import ToolArgValue from "./ToolArgValue.svelte";
  import { m } from "../../paraglide/messages.js";

  interface Props {
    args: Record<string, unknown> | undefined;
  }

  let { args }: Props = $props();

  const entries = $derived(Object.entries(args ?? {}));
</script>

{#if entries.length === 0}
  <p class="m-0 text-sm text-muted-foreground italic">{m.toolArgs_noArguments()}</p>
{:else}
  <dl class="m-0 flex flex-col gap-2">
    {#each entries as [key, value] (key)}
      <div class="min-w-0 rounded-lg bg-muted/50 p-2">
        <dt class="font-mono text-code font-medium text-muted-foreground">{key}</dt>
        <dd class="mt-1 min-w-0 break-words">
          <ToolArgValue {value} />
        </dd>
      </div>
    {/each}
  </dl>
{/if}

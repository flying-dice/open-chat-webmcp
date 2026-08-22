<script lang="ts">
  /**
   * Recursive renderer for one argument value (card 09) — the piece that
   * turns a tool call's `arguments` from a JSON blob into something a human
   * can actually scan for a hallucinated or dangerous parameter at ~320px.
   * Recurses via a self-import (Svelte 5's supported pattern — `svelte:self`
   * is deprecated): an object value becomes an indented key/value list, an
   * array becomes a numbered list, everything else renders as a single
   * readable line.
   *
   * Card 69 (decisions/28-shadcn-svelte-maia-zinc.md): scoped CSS replaced
   * with Tailwind utilities; deep structures still render in full (never
   * truncated).
   */
  import { isRecord } from "../presentation/untrustedJson";
  import Self from "./ToolArgValue.svelte";
  import { m } from "../../paraglide/messages.js";

  interface Props {
    value: unknown;
  }

  let { value }: Props = $props();
</script>

{#if value === null || value === undefined}
  <span class="text-muted-foreground italic"
    >{value === null ? m.toolArgValue_null() : m.toolArgValue_notProvided()}</span
  >
{:else if Array.isArray(value)}
  {#if value.length === 0}
    <span class="text-muted-foreground italic">{m.toolArgValue_emptyList()}</span>
  {:else}
    <ol class="mt-1 flex list-decimal flex-col gap-1 pl-5">
      {#each value as item, i (i)}
        <li><Self value={item} /></li>
      {/each}
    </ol>
  {/if}
{:else if isRecord(value)}
  {#if Object.keys(value).length === 0}
    <span class="text-muted-foreground italic">{m.toolArgValue_emptyObject()}</span>
  {:else}
    <dl class="mt-1 flex flex-col gap-1 border-l-2 border-border pl-2">
      {#each Object.entries(value) as [key, entryValue] (key)}
        <div class="flex flex-col">
          <dt class="font-mono text-code font-medium text-muted-foreground">{key}</dt>
          <dd class="m-0 min-w-0"><Self value={entryValue} /></dd>
        </div>
      {/each}
    </dl>
  {/if}
{:else if typeof value === "string"}
  <span class="font-mono text-code break-words whitespace-pre-wrap"
    >{value === "" ? m.toolArgValue_emptyString() : value}</span
  >
{:else if typeof value === "boolean"}
  <span class="font-mono text-code">{value ? m.toolArgValue_true() : m.toolArgValue_false()}</span>
{:else}
  <span class="font-mono text-code">{String(value)}</span>
{/if}

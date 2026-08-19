<script lang="ts">
  /**
   * Recursive renderer for one argument value (card 09) — the piece that
   * turns a tool call's `arguments` from a JSON blob into something a human
   * can actually scan for a hallucinated or dangerous parameter at ~320px.
   * Recurses via a self-import (Svelte 5's supported pattern — `svelte:self`
   * is deprecated): an object value becomes an indented key/value list, an
   * array becomes a numbered list, everything else renders as a single
   * readable line.
   */
  import Self from "./ToolArgValue.svelte";

  interface Props {
    value: unknown;
  }

  let { value }: Props = $props();

  function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }
</script>

{#if value === null || value === undefined}
  <span class="arg-null">{value === null ? "null" : "(not provided)"}</span>
{:else if Array.isArray(value)}
  {#if value.length === 0}
    <span class="arg-empty">[ ] (empty list)</span>
  {:else}
    <ol class="arg-list">
      {#each value as item, i (i)}
        <li><Self value={item} /></li>
      {/each}
    </ol>
  {/if}
{:else if isPlainObject(value)}
  {#if Object.keys(value).length === 0}
    <span class="arg-empty">{"{ } (empty object)"}</span>
  {:else}
    <dl class="arg-object">
      {#each Object.entries(value) as [key, entryValue] (key)}
        <div class="arg-row">
          <dt class="arg-key">{key}</dt>
          <dd class="arg-value"><Self value={entryValue} /></dd>
        </div>
      {/each}
    </dl>
  {/if}
{:else if typeof value === "string"}
  <span class="arg-string">{value === "" ? '""  (empty string)' : value}</span>
{:else if typeof value === "boolean"}
  <span class="arg-bool">{value ? "true" : "false"}</span>
{:else}
  <span class="arg-number">{String(value)}</span>
{/if}

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .arg-null,
  .arg-empty {
    color: var(--color-on-surface-variant);
    font-style: italic;
  }

  .arg-string,
  .arg-number,
  .arg-bool {
    font-family: var(--font-family-mono);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .arg-list {
    margin: var(--space-1) 0 0 0;
    padding-left: var(--space-4);
  }

  .arg-list li {
    margin-bottom: var(--space-1);
  }

  .arg-list li:last-child {
    margin-bottom: 0;
  }

  .arg-object {
    margin: var(--space-1) 0 0 0;
    padding: var(--space-1) var(--space-2);
    border-left: 2px solid var(--color-outline-variant);
  }

  .arg-row {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin-bottom: var(--space-1);
  }

  .arg-row:last-child {
    margin-bottom: 0;
  }

  .arg-key {
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
    font-family: var(--font-family-mono);
  }

  .arg-value {
    margin: 0;
    min-width: 0;
  }
</style>

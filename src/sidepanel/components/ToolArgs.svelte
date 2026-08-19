<script lang="ts">
  /**
   * Top-level "arguments" display for a tool call (card 09) — used by both
   * ApprovalCard.svelte (before the call runs, the one moment a user can
   * catch a hallucinated or dangerous parameter) and ToolCallCard.svelte's
   * expanded view (after, for the record). Deliberately NOT a
   * `JSON.stringify`'d blob: every top-level argument gets its own labeled
   * row, formatted by ToolArgValue.svelte, which recurses into nested
   * objects/arrays with indentation rather than flattening them into one
   * hard-to-scan line.
   */
  import ToolArgValue from "./ToolArgValue.svelte";

  interface Props {
    args: Record<string, unknown> | undefined;
  }

  let { args }: Props = $props();

  const entries = $derived(Object.entries(args ?? {}));
</script>

{#if entries.length === 0}
  <p class="no-args text-small">This call takes no arguments.</p>
{:else}
  <dl class="tool-args">
    {#each entries as [key, value] (key)}
      <div class="arg-row">
        <dt class="arg-key">{key}</dt>
        <dd class="arg-value"><ToolArgValue {value} /></dd>
      </div>
    {/each}
  </dl>
{/if}

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .no-args {
    margin: 0;
    font-style: italic;
  }

  .tool-args {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .arg-row {
    min-width: 0;
    background: var(--color-surface-container);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
  }

  .arg-key {
    font-weight: 600;
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .arg-value {
    margin: var(--space-1) 0 0 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>

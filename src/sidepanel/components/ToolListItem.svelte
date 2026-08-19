<script lang="ts">
  /**
   * One tool card in the Tools view (card 11): name, description,
   * annotations, and the tool's `source` — native / polyfill / our shim
   * (decisions/02-mainworld-webmcp-bridge.md), the single most useful thing
   * for debugging why a WebMCP site does or doesn't work as expected. The
   * input schema is collapsed by default (it's the least-often-needed
   * detail) behind the same chevron-button pattern ToolCallCard.svelte uses.
   *
   * Per decisions/05, `annotations` are reported by the page itself and are
   * not a security guarantee — the badges here say only what the page
   * claims, same wording discipline as ApprovalCard.svelte/ToolCallCard.svelte.
   */
  import type { SerializedTool } from "../../lib/protocol";
  import ToolSchema from "./ToolSchema.svelte";

  interface Props {
    tool: SerializedTool;
  }

  let { tool }: Props = $props();

  let expanded = $state(false);

  const readOnly = $derived(tool.annotations?.readOnlyHint === true);
  const destructive = $derived(tool.annotations?.destructiveHint === true);
  const unannotated = $derived(!tool.annotations || (!readOnly && !destructive));

  const sourceLabel: Record<SerializedTool["source"], string> = {
    native: "native",
    polyfill: "polyfill",
    shim: "our shim",
  };

  const sourceTitle: Record<SerializedTool["source"], string> = {
    native: "Registered against Chrome's built-in navigator.modelContext.",
    polyfill: "Registered against a polyfill the page shipped itself (e.g. @mcp-b/global).",
    shim: "The page assumed WebMCP support; our bridge is providing navigator.modelContext for it.",
  };
</script>

<div class="tool-item" data-destructive={destructive}>
  <div class="tool-item-head">
    <span class="tool-name">{tool.name}</span>
    <span class="badges">
      <span class="badge badge-source" title={sourceTitle[tool.source]}>{sourceLabel[tool.source]}</span>
      {#if destructive}
        <span class="badge badge-destructive">destructive</span>
      {/if}
      {#if readOnly}
        <span class="badge badge-readonly">read-only</span>
      {/if}
      {#if unannotated}
        <span class="badge badge-unannotated">unannotated</span>
      {/if}
    </span>
  </div>

  {#if tool.description}
    <p class="tool-desc text-small">{tool.description}</p>
  {/if}

  <button type="button" class="schema-toggle" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
    <span class="chevron" class:open={expanded} aria-hidden="true">▸</span>
    Input schema
  </button>

  {#if expanded}
    <div class="schema-body">
      <ToolSchema schema={tool.inputSchema} />
    </div>
  {/if}
</div>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .tool-item {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--color-outline);
    border-radius: var(--radius-card);
    background: var(--color-surface);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .tool-item[data-destructive="true"] {
    border-color: var(--color-danger);
  }

  .tool-item-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
    min-width: 0;
  }

  .tool-name {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-weight: 600;
    overflow-wrap: anywhere;
    min-width: 0;
  }

  .badges {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .badge {
    font-size: var(--font-size-small);
    line-height: 1;
    padding: 2px var(--space-1);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-outline);
    white-space: nowrap;
  }

  .badge-source {
    color: var(--color-on-surface-variant);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .badge-destructive {
    background: var(--color-danger);
    border-color: var(--color-danger);
    color: var(--color-on-primary);
    font-weight: 600;
  }

  .badge-readonly {
    color: var(--color-on-surface-variant);
  }

  .badge-unannotated {
    color: var(--color-on-surface-variant);
    border-style: dashed;
  }

  .tool-desc {
    margin: 0;
    color: var(--color-on-surface-variant);
    overflow-wrap: anywhere;
  }

  .schema-toggle {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    background: transparent;
    border: none;
    padding: 0;
    font-size: var(--font-size-small);
    color: var(--color-primary);
  }

  .schema-toggle:hover {
    background: transparent;
    text-decoration: underline;
  }

  .chevron {
    display: inline-block;
    transition: transform var(--transition-fast);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .schema-body {
    padding: var(--space-2);
    background: var(--color-surface-container);
    border-radius: var(--radius-sm);
    min-width: 0;
  }
</style>

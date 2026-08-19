<script lang="ts">
  /**
   * Renders one completed (or in-flight-after-approval) tool-call message
   * from the transcript (card 09, decisions/05). This is the AFTER view —
   * the BEFORE/decision view is ApprovalCard.svelte, which no longer exists
   * for this call by the time a `PanelMessage` row exists at all (see
   * src/sidepanel/services/agentLoop.ts's `executeToolCall`: `addToolCall`
   * only runs once a mode is already decided).
   *
   * Starts collapsed when `toolMode === "auto"` — a call nobody had to
   * review (a `readOnlyHint` call under the default policy, or any call
   * under "auto-run-all") — and expanded otherwise, since an "approved" or
   * "denied" mode means a human just made a real decision about this call
   * and seeing what it did stays useful. Either way it's always expandable:
   * "collapsed" only changes the INITIAL state, never hides the toggle.
   *
   * `toolAnnotations` is a snapshot taken at call time (panel.svelte.ts),
   * not a live lookup — see that field's doc comment for why. Per
   * decisions/05, annotations are page-supplied UX guidance, not a security
   * boundary; the destructive badge below says only "the page marked this
   * destructive," never "this call was safe."
   */
  import { untrack } from "svelte";
  import type { PanelMessage } from "../stores/panel.svelte";
  import ToolArgs from "./ToolArgs.svelte";

  interface Props {
    message: PanelMessage;
  }

  let { message }: Props = $props();

  // Deliberately reads `message.toolMode` ONCE, for the initial state only
  // — see the header comment: collapsed-vs-expanded is a starting point the
  // user can always toggle, not something that should snap shut/open again
  // as `message.toolStatus` changes underneath it (e.g. pending -> success).
  let expanded = $state(untrack(() => message.toolMode !== "auto"));

  const destructive = $derived(message.toolAnnotations?.destructiveHint === true);
  const readOnly = $derived(message.toolAnnotations?.readOnlyHint === true);
</script>

<div class="tool-card" data-status={message.toolStatus} data-destructive={destructive}>
  <button
    type="button"
    class="tool-card-header"
    aria-expanded={expanded}
    onclick={() => (expanded = !expanded)}
  >
    <span class="chevron" class:open={expanded} aria-hidden="true">▸</span>
    <span class="tool-name">{message.toolName}</span>
    <span class="header-badges">
      {#if destructive}
        <span class="badge badge-destructive">destructive</span>
      {/if}
      {#if message.toolMode === "auto"}
        <span class="badge badge-auto">{readOnly ? "auto · read-only" : "auto-run"}</span>
      {/if}
    </span>
    <span class="tool-status text-small">{message.toolStatus}</span>
  </button>

  {#if expanded}
    <div class="tool-card-body">
      <div class="args-section">
        <h3>Arguments</h3>
        <ToolArgs args={message.toolArgs} />
      </div>

      {#if message.content}
        <div class="result-section">
          <h3>{message.toolStatus === "error" || message.toolStatus === "denied" ? "Error" : "Result"}</h3>
          <div class="tool-content text-small">{message.content}</div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .tool-card {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--color-outline);
    border-radius: var(--radius-card);
    background: var(--color-surface);
    overflow: hidden;
  }

  .tool-card[data-destructive="true"] {
    border-color: var(--color-danger);
  }

  .tool-card-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-container);
    border: none;
    border-radius: 0;
    text-align: left;
  }

  .chevron {
    flex: 0 0 auto;
    display: inline-block;
    transition: transform var(--transition-fast);
    color: var(--color-on-surface-variant);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .tool-name {
    flex: 1 1 auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: var(--font-size-small);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .header-badges {
    flex: 0 0 auto;
    display: flex;
    gap: var(--space-1);
  }

  .badge {
    font-size: var(--font-size-small);
    line-height: 1;
    padding: 2px var(--space-1);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-outline);
    white-space: nowrap;
  }

  .badge-destructive {
    background: var(--color-danger);
    border-color: var(--color-danger);
    color: var(--color-on-primary);
    font-weight: 600;
  }

  .badge-auto {
    color: var(--color-on-surface-variant);
  }

  .tool-status {
    flex: 0 0 auto;
    text-transform: capitalize;
    white-space: nowrap;
    color: var(--color-on-surface-variant);
  }

  .tool-card[data-status="error"] .tool-status,
  .tool-card[data-status="denied"] .tool-status {
    color: var(--color-danger);
  }

  .tool-card-body {
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-top: 1px solid var(--color-outline-variant);
  }

  .args-section h3,
  .result-section h3 {
    margin-bottom: var(--space-1);
  }

  .tool-content {
    padding: var(--space-2);
    background: var(--color-surface-container);
    border-radius: var(--radius-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .tool-card[data-status="error"] .tool-content,
  .tool-card[data-status="denied"] .tool-content {
    color: var(--color-danger);
  }
</style>

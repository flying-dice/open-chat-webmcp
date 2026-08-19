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
   * decisions/05 and decisions/17, annotations are page-supplied UX
   * guidance, not a security boundary; the badges below say only what the
   * page claimed, never that a call was verified safe.
   *
   * `ToolAnnotations` is exactly `{ readOnlyHint, untrustedContentHint }` —
   * there is no `destructiveHint` (decisions/17). When `toolAnnotations`
   * carries `untrustedContentHint: true`, the result below is the same
   * fenced text sent to the model (src/sidepanel/services/agentLoop.ts's
   * `fenceUntrustedContent`) — the badge just calls out why it reads that
   * way, so a human scanning the transcript can tell an untrusted-source
   * result apart from an ordinary one.
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

  const readOnly = $derived(message.toolAnnotations?.readOnlyHint === true);
  const untrustedContent = $derived(message.toolAnnotations?.untrustedContentHint === true);
</script>

<div class="tool-card" data-status={message.toolStatus}>
  <button
    type="button"
    class="tool-card-header"
    aria-expanded={expanded}
    onclick={() => (expanded = !expanded)}
  >
    <span class="chevron" class:open={expanded} aria-hidden="true">▸</span>
    <span class="tool-name">{message.toolName}</span>
    <span class="header-badges">
      {#if untrustedContent}
        <span class="badge badge-untrusted">untrusted content</span>
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
          <h3>
            {message.toolStatus === "error" || message.toolStatus === "denied" ? "Error" : "Result"}
            {#if untrustedContent && message.toolStatus === "success"}
              <span class="untrusted-note">— page-authored, treated as untrusted data</span>
            {/if}
          </h3>
          <div class="tool-content text-small" data-untrusted={untrustedContent && message.toolStatus === "success"}>{message.content}</div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     and src/sidepanel/chat-theme.css (decisions/18). */

  /* Filled and borderless. The assistant's reply is now bare text on the
     panel surface, so an outlined card sitting on that same surface would
     read as a foreign object; a filled block reads as an inset within the
     turn, which is what it is. */
  .tool-card {
    width: 100%;
    min-width: 0;
    border: none;
    border-radius: var(--radius-lg);
    background: var(--color-surface-container);
    overflow: hidden;
  }

  .tool-card-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-container-high);
    border: none;
    border-radius: 0;
    text-align: left;
  }

  .tool-card-header:hover {
    background: var(--color-surface-container-highest);
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
    font-family: var(--font-family-mono);
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

  /* theme.css has no separate "warning" token (decisions/08) — this reuses
     --color-danger, the only attention colour available, purely to catch
     the eye; it does not imply the call itself is dangerous to make. */
  .badge-untrusted {
    color: var(--color-danger);
    border-color: var(--color-danger);
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

  .untrusted-note {
    font-size: var(--font-size-small);
    font-weight: 400;
    color: var(--color-danger);
  }

  .tool-content {
    padding: var(--space-2);
    background: var(--color-surface-container);
    border-radius: var(--radius-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* Marks the exact block of text that came back from an
     `untrustedContentHint` tool (decisions/17) — the same fenced text sent
     to the model, minus the delimiters themselves (see
     src/sidepanel/services/agentLoop.ts's `fenceUntrustedContent`). */
  .tool-content[data-untrusted="true"] {
    border: 1px dashed var(--color-danger);
  }

  .tool-card[data-status="error"] .tool-content,
  .tool-card[data-status="denied"] .tool-content {
    color: var(--color-danger);
  }
</style>

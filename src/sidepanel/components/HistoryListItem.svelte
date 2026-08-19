<script lang="ts">
  /**
   * One entry in the History view (card 34, decisions/13-global-tab-aware-
   * chat-history.md): enough to recognise a past chat without opening it —
   * the origin it was started against, when it was last active, and a
   * preview of its first message — plus open/delete actions. The whole row
   * is a button (opens the chat); delete is a second, smaller button inside
   * it that stops the click from bubbling to the row.
   *
   * `active` highlights the chat currently open in this tab
   * (`panel.activeChatId`, compared by the parent) so it's obvious which
   * entry the transcript view would show if you switched back to it.
   */
  import type { ChatSummary } from "../../lib/session";

  interface Props {
    summary: ChatSummary;
    active: boolean;
    opening: boolean;
    deleting: boolean;
    onOpen: () => void;
    onDelete: () => void;
  }

  let { summary, active, opening, deleting, onOpen, onDelete }: Props = $props();

  function formatOrigin(origin: string): string {
    return origin || "(unknown origin)";
  }

  function formatTime(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  function handleDeleteClick(event: MouseEvent): void {
    event.stopPropagation();
    onDelete();
  }
</script>

<div class="history-item" data-active={active}>
  <button
    type="button"
    class="history-item-main"
    onclick={onOpen}
    disabled={opening || deleting}
    aria-current={active}
  >
    <div class="history-item-head">
      <span class="history-origin">{formatOrigin(summary.origin)}</span>
      {#if active}
        <span class="badge badge-active">current</span>
      {/if}
    </div>

    <p class="history-preview">
      {summary.preview ?? "(no messages yet)"}
    </p>

    <span class="history-meta text-small">
      {formatTime(summary.updatedAt)} ·
      {summary.messageCount} message{summary.messageCount === 1 ? "" : "s"}
      {#if summary.toolCallCount > 0}
        · {summary.toolCallCount} tool call{summary.toolCallCount === 1 ? "" : "s"}
      {/if}
    </span>
  </button>

  <button
    type="button"
    class="delete-button text-small"
    onclick={handleDeleteClick}
    disabled={opening || deleting}
    aria-label={`Delete chat from ${formatOrigin(summary.origin)}`}
  >
    {deleting ? "Deleting…" : "Delete"}
  </button>
</div>

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .history-item {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    border: 1px solid var(--color-outline);
    border-radius: var(--radius-card);
    background: var(--color-surface);
    overflow: hidden;
  }

  .history-item[data-active="true"] {
    border-color: var(--color-primary);
  }

  .history-item-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    background: transparent;
    border: none;
    border-radius: 0;
    padding: var(--space-2);
    text-align: left;
  }

  .history-item-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    width: 100%;
  }

  .history-origin {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .badge-active {
    flex: 0 0 auto;
    font-size: var(--font-size-small);
    line-height: 1;
    padding: 2px var(--space-1);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-primary);
    color: var(--color-primary);
    white-space: nowrap;
  }

  .history-preview {
    margin: 0;
    width: 100%;
    color: var(--color-on-surface-variant);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-meta {
    color: var(--color-on-surface-variant);
  }

  .delete-button {
    flex: 0 0 auto;
    align-self: center;
    margin-right: var(--space-2);
    padding: var(--space-1) var(--space-2);
    color: var(--color-danger);
    white-space: nowrap;
  }
</style>

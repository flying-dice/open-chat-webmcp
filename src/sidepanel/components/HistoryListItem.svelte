<script lang="ts">
  /**
   * One entry in the History view (card 34, decisions/13-global-tab-aware-
   * chat-history.md): enough to recognise a past chat without opening it —
   * its title (derived from the first message, see lib/chatTitle.ts), the
   * origin it was started against, and when it was last active — plus
   * open/delete actions. The whole row is a button (opens the chat); delete
   * is a second, smaller button inside it that stops the click from
   * bubbling to the row.
   *
   * `active` highlights the chat currently open in this tab
   * (`panel.activeChatId`, compared by the parent) so it's obvious which
   * entry the transcript view would show if you switched back to it.
   */
  import type { ChatSummary } from "../../lib/session";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";
  import { titleFromSummary } from "../lib/chatTitle";

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
    <span class="row-icon" aria-hidden="true"><Icon name="subject" size={20} /></span>

    <span class="history-item-text">
      <span class="history-item-head">
        <!-- Titled by its first message, exactly as the overflow menu's
             recent-chats rows are, so the same chat is called the same
             thing in both places. The origin moves down to the meta line —
             it identifies the chat, but it isn't its name. -->
        <span class="history-title">{titleFromSummary(summary)}</span>
        {#if active}
          <span class="badge badge-active">current</span>
        {/if}
      </span>

      <span class="history-meta text-small">
        {formatOrigin(summary.origin)} · {formatTime(summary.updatedAt)} ·
        {summary.messageCount} message{summary.messageCount === 1 ? "" : "s"}
        {#if summary.toolCallCount > 0}
          · {summary.toolCallCount} tool call{summary.toolCallCount === 1 ? "" : "s"}
        {/if}
      </span>
    </span>
  </button>

  <span class="delete-slot">
    <IconButton
      icon="delete"
      label={deleting ? "Deleting…" : `Delete chat from ${formatOrigin(summary.origin)}`}
      tone="danger"
      disabled={opening || deleting}
      onclick={handleDeleteClick}
    />
  </span>
</div>

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css and
     src/sidepanel/chat-theme.css (decisions/18). */

  /* A row, not a card: the history view is a list of one kind of thing, and
     boxing each entry at this width wastes most of it on borders. The
     active entry is tinted the same way the overflow menu tints it. */
  .history-item {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    border: none;
    border-radius: var(--radius-card);
    background: transparent;
    overflow: hidden;
  }

  .history-item:hover {
    background: var(--state-hover);
  }

  .history-item[data-active="true"] {
    background: var(--color-secondary-container);
    color: var(--color-on-secondary-container);
  }

  .history-item-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    background: transparent;
    border: none;
    border-radius: 0;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    text-align: left;
    color: inherit;
  }

  .history-item-main:hover {
    background: transparent;
  }

  .row-icon {
    display: inline-flex;
    flex: none;
    color: var(--color-on-surface-variant);
  }

  .history-item-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .history-item-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    width: 100%;
  }

  .history-title {
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

  .history-meta {
    color: var(--color-on-surface-variant);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .history-item[data-active="true"] .history-meta {
    color: inherit;
    opacity: 0.75;
  }

  .delete-slot {
    display: inline-flex;
    flex: none;
    margin-right: var(--space-1);
  }
</style>

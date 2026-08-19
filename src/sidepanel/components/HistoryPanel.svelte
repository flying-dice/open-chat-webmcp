<script lang="ts">
  /**
   * History view (card 34, decisions/13-global-tab-aware-chat-history.md):
   * every stored chat, newest first, across every site — not just this
   * tab's. Reads/deletes go straight to src/lib/session.ts (the same
   * pattern src/options/components/SettingsSection.svelte already uses for
   * its "clear all history" list), since a `ChatSummary` never holds a live
   * message array that could go stale against the panel's single-owner
   * `ChatSession` (card 29) — only OPENING a chat needs to go through
   * panel.svelte.ts, because that's what swaps the live in-memory session.
   *
   * Opening a chat started against a different origin than the current tab
   * is allowed (decision 13) — this view doesn't gate that at all, it just
   * hands off to `openChatInTab`; the honesty notice about tools/origin
   * mismatch lives in App.svelte, next to the transcript itself, since it
   * applies for as long as that chat stays open, not just at the moment of
   * opening it from here.
   */
  import { deleteChat, listChatSummaries, type ChatSummary } from "../../lib/session";
  import { discardActiveChatIfDeleted, openChatInTab, panel } from "../stores/panel.svelte";
  import HistoryListItem from "./HistoryListItem.svelte";

  let summaries = $state<ChatSummary[]>([]);
  let status = $state<"loading" | "loaded">("loading");
  let openingId = $state<string | undefined>(undefined);
  let deletingId = $state<string | undefined>(undefined);

  async function refresh(): Promise<void> {
    summaries = await listChatSummaries();
  }

  // Re-list every time this view mounts (switching to it from Chat/Tools &
  // Log) rather than once ever, so a chat that just picked up its first
  // message (and therefore its first preview/entry) shows up without
  // needing the panel to reload.
  $effect(() => {
    status = "loading";
    void refresh().finally(() => {
      status = "loaded";
    });
  });

  async function handleOpen(chatId: string): Promise<void> {
    if (openingId || deletingId) return;
    openingId = chatId;
    try {
      await openChatInTab(chatId);
    } finally {
      openingId = undefined;
    }
  }

  async function handleDelete(summary: ChatSummary): Promise<void> {
    if (openingId || deletingId) return;
    const label = summary.origin || "this chat";
    const ok = confirm(
      `Delete the chat from ${label} (${summary.messageCount} message${summary.messageCount === 1 ? "" : "s"})? This cannot be undone.`,
    );
    if (!ok) return;

    deletingId = summary.id;
    try {
      await deleteChat(summary.id);
      // If this was the chat currently open in this tab, point the tab at
      // a fresh one — otherwise the next message sent would silently
      // recreate the chat we just deleted (see that function's doc
      // comment).
      await discardActiveChatIfDeleted(summary.id);
      await refresh();
    } finally {
      deletingId = undefined;
    }
  }
</script>

<div class="history-panel">
  {#if status === "loading"}
    <p class="text-small">Loading…</p>
  {:else if summaries.length === 0}
    <div class="empty-state">
      <p>No chats yet.</p>
      <p class="text-small">
        Every conversation you have — on any site, in any tab — is listed here,
        newest first, once it has at least one message. Nothing is deleted
        automatically; use the delete button on an entry, or "Clear all
        history" on the options page, when you're done with one.
      </p>
    </div>
  {:else}
    <ul class="history-list">
      {#each summaries as summary (summary.id)}
        <li>
          <HistoryListItem
            {summary}
            active={panel.activeChatId === summary.id}
            opening={openingId === summary.id}
            deleting={deletingId === summary.id}
            onOpen={() => handleOpen(summary.id)}
            onDelete={() => handleDelete(summary)}
          />
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css and
     src/sidepanel/chat-theme.css (decisions/18). */

  /* Since decisions/18 this is a full-panel view reached from the overflow
     menu rather than a pane under a tab strip, so it owns its own scroller
     and padding — previously it had neither and relied on the shell. */
  .history-panel {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
    padding: var(--space-2) var(--space-3) var(--space-4);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-1);
    color: var(--color-on-surface-variant);
  }

  .empty-state p {
    margin: 0;
  }

  .history-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    /* Rows, not cards: they carry their own hover/active fill and need no
       gutter between them. */
    gap: 0;
    min-width: 0;
  }
</style>

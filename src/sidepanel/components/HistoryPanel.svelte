<script lang="ts">
  /**
   * History view (card 34, decisions/13-global-tab-aware-chat-history.md):
   * every stored chat, newest first, across every site — not just this
   * tab's. Reads/deletes go straight to the `ChatStore` port (the same
   * pattern src/options/components/SettingsSection.svelte already uses for
   * its "clear all history" list), since a `ChatSummary` never holds a live
   * message array that could go stale against the panel's single-owner
   * `ChatSession` (card 29) — only OPENING a chat needs to go through
   * panel.svelte.ts, because that's what swaps the live in-memory session.
   *
   * Opening a chat started against a different origin than the current tab
   * is allowed (decision 13) — this view doesn't gate that at all, it just
   * hands off to `chat.openChat`; the honesty notice about tools/origin
   * mismatch lives in App.svelte, next to the transcript itself, since it
   * applies for as long as that chat stays open, not just at the moment of
   * opening it from here.
   *
   * Re-skinned onto shadcn's Item/ScrollArea/Empty primitives (card 70,
   * decisions/28) — no behaviour change, presentation only.
   */
  import type { ChatSummary } from "../../domain/chat";
  import { chat, sidePanelServices } from "../app-services";
  import { panel } from "../stores/panel.svelte";
  import HistoryListItem from "./HistoryListItem.svelte";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { ItemGroup } from "$lib/components/ui/item";
  import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
  } from "$lib/components/ui/empty";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { BubbleChatIcon } from "@hugeicons/core-free-icons";

  interface Props {
    /** Switch back to the chat view — called only once opening a chat actually succeeds. */
    onOpenChat: () => void;
  }

  const { onOpenChat }: Props = $props();

  let summaries = $state<ChatSummary[]>([]);
  let status = $state<"loading" | "loaded">("loading");
  let openingId = $state<string | undefined>(undefined);
  let deletingId = $state<string | undefined>(undefined);

  async function refresh(): Promise<void> {
    const [loaded, err] = await sidePanelServices().chats.listChatSummaries();
    // Card 92: the listing's failure is now a value, and this view has no
    // error state to render it in yet — card 95 is where every surface grows
    // one. Until then the previous list stands and the reason goes to the
    // console, which is strictly more than the unhandled rejection this
    // replaces left behind.
    if (err) {
      console.warn("[webmcp][history] could not list chats", err);
      return;
    }
    summaries = loaded;
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
      if (await chat().openChat(chatId)) onOpenChat();
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
      // Card 92: a delete that did not land must not be followed by the
      // fresh-chat swap or the re-list — the rejection this replaces skipped
      // both, and doing them anyway would show the chat as gone while it is
      // still in storage and still the tab's current chat.
      const [, err] = await sidePanelServices().chats.deleteChat(summary.id);
      if (err) {
        console.warn("[webmcp][history] could not delete the chat", err);
        return;
      }
      // If this was the chat currently open in this tab, point the tab at
      // a fresh one — otherwise the next message sent would silently
      // recreate the chat we just deleted (see that function's doc
      // comment).
      await chat().discardIfDeleted(summary.id);
      await refresh();
    } finally {
      deletingId = undefined;
    }
  }
</script>

<ScrollArea class="min-h-0 min-w-0 flex-1">
  <div class="min-w-0 p-3">
    {#if status === "loading"}
      <p class="p-2 text-sm text-muted-foreground">Loading…</p>
    {:else if summaries.length === 0}
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={BubbleChatIcon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>No chats yet</EmptyTitle>
          <EmptyDescription>
            Every conversation you have — on any site, in any tab — is listed here,
            newest first, once it has at least one message. Nothing is deleted
            automatically; use the delete button on an entry, or "Clear all
            history" on the options page, when you're done with one.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    {:else}
      <ItemGroup>
        {#each summaries as summary (summary.id)}
          <HistoryListItem
            {summary}
            active={panel.activeChatId === summary.id}
            opening={openingId === summary.id}
            deleting={deletingId === summary.id}
            onOpen={() => handleOpen(summary.id)}
            onDelete={() => handleDelete(summary)}
          />
        {/each}
      </ItemGroup>
    {/if}
  </div>
</ScrollArea>

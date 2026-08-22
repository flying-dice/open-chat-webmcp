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
   *
   * Re-skinned onto shadcn's Item primitive (decisions/28) — Item itself
   * renders the row and carries `role="listitem"` for the ItemGroup list in
   * HistoryPanel; the open button and delete button are its two children.
   */
  import type { ChatSummary } from "../../domain/chat";
  import { titleFromSummary } from "../lib/chatTitle";
  import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "$lib/components/ui/item";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { BubbleChatIcon, Delete02Icon } from "@hugeicons/core-free-icons";

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

  const deleteLabel = $derived(
    deleting ? "Deleting…" : `Delete chat from ${formatOrigin(summary.origin)}`,
  );
</script>

<Item
  role="listitem"
  variant={active ? "muted" : "default"}
  class={active ? "gap-1 p-1" : "gap-1 p-1 hover:bg-muted/50"}
>
  <button
    type="button"
    class="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left disabled:pointer-events-none disabled:opacity-50"
    onclick={onOpen}
    disabled={opening || deleting}
    aria-current={active}
  >
    <ItemMedia variant="icon">
      <HugeiconsIcon icon={BubbleChatIcon} strokeWidth={2} />
    </ItemMedia>

    <ItemContent>
      <ItemTitle class="w-full">
        <span class="min-w-0 flex-1 truncate">{titleFromSummary(summary)}</span>
        {#if active}
          <Badge variant="secondary" class="shrink-0">current</Badge>
        {/if}
      </ItemTitle>

      <ItemDescription class="line-clamp-1">
        {formatOrigin(summary.origin)} · {formatTime(summary.updatedAt)} ·
        {summary.messageCount} message{summary.messageCount === 1 ? "" : "s"}
        {#if summary.toolCallCount > 0}
          · {summary.toolCallCount} tool call{summary.toolCallCount === 1 ? "" : "s"}
        {/if}
      </ItemDescription>
    </ItemContent>
  </button>

  <ItemActions>
    <Button
      variant="ghost"
      size="icon-sm"
      class="text-muted-foreground hover:text-destructive"
      aria-label={deleteLabel}
      disabled={opening || deleting}
      onclick={handleDeleteClick}
    >
      <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
    </Button>
  </ItemActions>
</Item>

<script lang="ts">
  /**
   * One entry in the History view (card 34, decisions/13-global-tab-aware-
   * chat-history.md): enough to recognise a past chat without opening it —
   * its title (derived from the first message, see src/domain/chat/title.ts), the
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
   * The delete button also carries a shadcn Tooltip (card 89), restoring
   * the hover affordance the Item migration (card 70) dropped; it's skipped
   * while the button is disabled (opening/deleting), same as IconButton.
   */
  import type { ChatSummary } from "../../domain/chat";
  import { titleFromSummary } from "../../domain/chat";
  import { isolateLtr } from "../../ui/bidi";
  import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemMedia,
    ItemTitle,
  } from "$lib/components/ui/item";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { BubbleChatIcon, Delete02Icon } from "@hugeicons/core-free-icons";
  import { m } from "../../paraglide/messages.js";

  interface Props {
    summary: ChatSummary;
    active: boolean;
    opening: boolean;
    deleting: boolean;
    onOpen: () => void;
    onDelete: () => void;
  }

  let { summary, active, opening, deleting, onOpen, onDelete }: Props = $props();

  // The origin renders both inline (the description line, no element
  // boundary of its own around just this part) and interpolated into
  // `deleteLabel`'s translated sentence below, so it is Unicode-isolated at
  // the source rather than via a `dir="ltr"` element (card 104's RTL
  // bidi-isolation pass).
  function formatOrigin(origin: string): string {
    return origin ? isolateLtr(origin) : m.historyListItem_unknownOrigin();
  }

  function formatTime(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  function handleDeleteClick(event: MouseEvent): void {
    event.stopPropagation();
    onDelete();
  }

  const deleteLabel = $derived(
    deleting
      ? m.historyListItem_deletingLabel()
      : m.historyListItem_deleteLabel({ origin: formatOrigin(summary.origin) }),
  );
</script>

<Item
  role="listitem"
  variant={active ? "muted" : "default"}
  class={active ? "gap-1 p-1" : "gap-1 p-1 hover:bg-muted/50"}
>
  <button
    type="button"
    class="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-start disabled:pointer-events-none disabled:opacity-50"
    onclick={onOpen}
    disabled={opening || deleting}
    aria-current={active}
  >
    <ItemMedia variant="icon">
      <HugeiconsIcon icon={BubbleChatIcon} strokeWidth={2} />
    </ItemMedia>

    <ItemContent>
      <ItemTitle class="w-full">
        <span class="min-w-0 flex-1 truncate">{titleFromSummary(summary, m.chatTitle_untitled())}</span>
        {#if active}
          <Badge variant="secondary" class="shrink-0">{m.historyListItem_currentBadge()}</Badge>
        {/if}
      </ItemTitle>

      <ItemDescription class="line-clamp-1">
        {formatOrigin(summary.origin)} · {formatTime(summary.updatedAt)} ·
        {m.historyListItem_messageCount({ count: summary.messageCount })}
        {#if summary.toolCallCount > 0}
          · {m.historyListItem_toolCallCount({ count: summary.toolCallCount })}
        {/if}
      </ItemDescription>
    </ItemContent>
  </button>

  <ItemActions>
    {#if opening || deleting}
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground hover:text-destructive"
        aria-label={deleteLabel}
        disabled
        onclick={handleDeleteClick}
      >
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
      </Button>
    {:else}
      <!-- Restores the hover/focus tooltip the delete button lost in the
           Item migration (card 70's journal). shadcn's Tooltip.Trigger is
           wired directly onto the Button itself via bits-ui's `child`
           snippet, the same pattern IconButton.svelte uses — see
           IconButton.svelte's doc comment for why a focusable trigger needs
           the wiring on itself rather than through a wrapping span. The
           accessible name stays exactly `deleteLabel`, unchanged. -->
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-sm"
                class="text-muted-foreground hover:text-destructive"
                aria-label={deleteLabel}
                onclick={handleDeleteClick}
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content side="top">
            {deleteLabel}
          </Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    {/if}
  </ItemActions>
</Item>

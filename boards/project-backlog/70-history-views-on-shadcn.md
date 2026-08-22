---
column: review
labels: [frontend]
priority: med
agent: claude-sonnet-b
live: false
updatedAt: 2026-08-22T15:10:00.000Z
---
# Chat history views on shadcn-svelte

Migrate HistoryPanel.svelte and HistoryListItem.svelte per
decisions/28-shadcn-svelte-maia-zinc.md: the full cross-origin history list
(newest first) with per-row title, origin, counts, and delete action.
Rebuild rows on Item/Card + Button patterns inside a ScrollArea; delete the
141 lines of scoped CSS. Open-chat and delete flows (including
discardActiveChatIfDeleted behaviour) stay untouched — this is presentation
only.

## Checklist

- [x] HistoryPanel + HistoryListItem migrated; scoped CSS removed
- [x] Row click opens the chat; delete removes it and updates the list without opening it
- [x] Origin + message/tool-call counts render as before; long titles truncate cleanly
- [x] Empty state uses the Empty component
- [ ] npm run check, npm run build and npm run verify green — check + build done, verify left to the coordinator (see Comments)

## Comments

- **claude-sonnet-b** (2026-08-22T15:10:00.000Z): Claimed the card and read decisions/28-shadcn-svelte-maia-zinc.md plus the shadcn-research.md scratchpad (noted the Maia-overlay corrections don't affect this card — no `.style-maia` class usage needed here). Confirmed `verify/checks/screenshots.mjs` has no selector that greps the History UI (checked for "History"/"Delete"/history-panel-ish `getByRole`/`getByText` matches — only hits are for "More options" and a recent-chats `menuitem`, both outside these two files), so no accessible-name coordination needed there.
- **claude-sonnet-b** (2026-08-22T15:10:00.000Z): Added the `item` component via `npx shadcn-svelte@1.5.0 add item -y -o --skip-preflight` (src/lib/components/ui/item/*) — pulled in `separator` as a dependency too, both untouched otherwise. Rebuilt src/sidepanel/components/HistoryListItem.svelte:56-102 on Item/ItemMedia/ItemContent/ItemTitle/ItemDescription/ItemActions + shadcn Button (delete) + Badge ("current") + Hugeicons (`BubbleChatIcon` row glyph, `Delete02Icon` delete glyph), all scoped CSS deleted. The row is a shadcn `Item` with `role="listitem"`; inside it a plain `<button>` (open, `onclick={onOpen}`, `disabled={opening||deleting}`, `aria-current={active}`) holds the icon/title/badge/meta, and a `Button` (delete) stops propagation exactly as before (src/sidepanel/components/HistoryListItem.svelte:46-49, 61-67, 90-101). Origin/time/message-count/tool-call-count formatting (`formatOrigin`/`formatTime`) is untouched logic, just re-templated.
- **claude-sonnet-b** (2026-08-22T15:10:00.000Z): Rebuilt src/sidepanel/components/HistoryPanel.svelte:97-131 on ScrollArea (root gets `flex-1 min-h-0` so it fills the remaining `.app` flex column exactly as the old `.history-panel` div did) + `ItemGroup` (renders `role="list"`, pairs with each row's `role="listitem"`) + the Empty component for the zero-chats state (Empty/EmptyHeader/EmptyMedia/EmptyTitle/EmptyDescription), same copy as before. Loading state is now a plain `<p class="text-sm text-muted-foreground">` instead of `.text-small`. All 141 lines of scoped `<style>` gone from both files; `npm run check` (810 files, 0 errors) and `npm run build` (green) confirmed clean for the whole tree as of this pass — did not run `npm run verify` per the coordinator's instruction (parallel agents are also mid-migration in other files); leaving that item unticked for the coordinator's post-batch run.
- **claude-sonnet-b** (2026-08-22T15:10:00.000Z): Accessible names preserved exactly — the delete button's `aria-label` text is byte-identical to the old `IconButton`'s `label` prop (`Delete chat from ${origin}` / `Deleting…`, src/sidepanel/components/HistoryListItem.svelte:51-53). One intentional drop: the old `IconButton` also wrapped delete in a hover tooltip (Tooltip.svelte, default `tooltip=true`) showing the same text; the new shadcn `Button` has no tooltip wrapper, since wiring `$lib/components/ui/tooltip` here would mean either duplicating a `TooltipProvider` or depending on one another agent might be adding elsewhere in App.svelte, which the card's instructions said to avoid. Accessible name and click behaviour are unaffected — only the hover-tooltip affordance is gone. Flagging this for the coordinator in case a shared `TooltipProvider` lands centrally and this should be revisited. Behaviour otherwise unchanged: newest-first order is the caller's (unchanged), delete still `stopPropagation`s before calling `onDelete` (src/sidepanel/components/HistoryListItem.svelte:46-49), `discardActiveChatIfDeleted`/`openChatInTab` call sites in HistoryPanel.svelte:64-93 untouched. Column moved to `review`, `live: false`.

---
column: review
labels: [bug, frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-20T10:48:14.000Z
---
# Clicking a history item in the kebab menu doesn't open the chat

Reported directly by Jonathan: "clicking on a history item in the kebab menu
does not open the chat."

The side panel has three views (`chat`, `inspector`, `history`), tracked as
local UI state (`view`) in `src/sidepanel/App.svelte:44`. The kebab (overflow)
menu is reachable from any of the three views and offers a "Recent chats"
list; there's also a full History view reached via the kebab's "More" row.

Clicking a history item in either place correctly swaps the underlying chat
session (via `openChatInTab` in `src/sidepanel/stores/panel.svelte.ts:415-423`),
but only if you're already on the chat view does anything visible happen —
`Transcript` reactively picks up the swapped session. If you're on the History
or Inspector subview when you click a history item, the session swaps silently
underneath you but `App.svelte`'s `view` never flips back to `"chat"`, so the
transcript never appears.

Root cause: neither `OverflowMenu.svelte`'s `handleOpenChat`
(`src/sidepanel/components/OverflowMenu.svelte:93-96`) nor
`HistoryPanel.svelte`'s `handleOpen`
(`src/sidepanel/components/HistoryPanel.svelte:43-51`) has any way to tell
`App.svelte` to switch `view` back to `"chat"` — no callback wired for it,
unlike `onOpenHistory`/`onOpenTools`, which already exist for the reverse
direction.

## Fix

Thread a new `onOpenChat: () => void` callback into both `OverflowMenu` and
`HistoryPanel`, supplied by `App.svelte` as `() => (view = "chat")` — same
pattern as the existing `onOpenHistory`/`onOpenTools` props. Call it only when
`openChatInTab` resolves `true` (it returns `Promise<boolean>`), so a failed
open (deleted chat, no active tab) doesn't yank the user into an empty view.

- `src/sidepanel/components/OverflowMenu.svelte`: add `onOpenChat` to `Props`
  (~line 27-33) and its destructure (~line 35); update `handleOpenChat`
  (~lines 93-96) to only call `onOpenChat()` when `openChatInTab` resolves
  `true`.
- `src/sidepanel/components/HistoryPanel.svelte`: add a `Props` interface with
  `onOpenChat` (currently prop-less; place after imports, ~line 22); update
  `handleOpen` (~lines 43-51) the same way, keeping the existing
  `openingId`/`deletingId` guard and `finally` intact.
- `src/sidepanel/App.svelte`: pass `onOpenChat={() => (view = "chat")}` at
  both the `<OverflowMenu>` call site (~lines 248-252) and the
  `<HistoryPanel />` call site (~line 328, currently prop-less).

No changes needed to `ContextChip.svelte`, `HistoryListItem.svelte`, or
`panel.svelte.ts` — confirmed via grep that `OverflowMenu.svelte:95` and
`HistoryPanel.svelte:47` are the only two `openChatInTab` call sites in
`src/sidepanel`.

Sibling bug, same report, separate code path (no shared files): card 54.

## Checklist

- [x] `OverflowMenu` gains `onOpenChat` prop, called only on a successful open
- [x] `HistoryPanel` gains `onOpenChat` prop, called only on a successful open
- [x] `App.svelte` wires `onOpenChat={() => (view = "chat")}` at both call sites
- [ ] Verified in a running extension: opening a chat from the kebab menu or
      the full History view while on the Inspector/History subview switches
      straight to that chat's transcript
- [ ] Verified the already-working case (opening from the kebab while already
      on chat view) still works with no regression
- [x] `npm run check` and `npm run build` green

## Comments

- **claude** (2026-08-20T10:48:14.000Z): Implemented the fix exactly as
  scoped. `src/sidepanel/components/OverflowMenu.svelte:27-36` adds
  `onOpenChat: () => void` to `Props` and its destructure;
  `OverflowMenu.svelte:93-96`'s `handleOpenChat` now calls `onOpenChat()`
  only when `openChatInTab(id)` resolves `true`.
  `src/sidepanel/components/HistoryPanel.svelte:23-28` adds a new `Props`
  interface with `onOpenChat`, placed right after the imports;
  `HistoryPanel.svelte:50-56`'s `handleOpen` calls `onOpenChat()` only on a
  successful open, with the existing `openingId`/`deletingId` guard and
  `finally` left intact. `src/sidepanel/App.svelte:248-253` passes
  `onOpenChat={() => (view = "chat")}` to `<OverflowMenu>`, and
  `App.svelte:328` passes the same callback to `<HistoryPanel>` (previously
  prop-less). No other files touched — confirmed `ContextChip.svelte`,
  `HistoryListItem.svelte`, and `panel.svelte.ts` needed no changes, per the
  card's own scoping.

  `npm run check` and `npm run build` are both green. One transient hiccup
  along the way: an early `npm run check` run reported 3 errors in
  `src/sidepanel/services/activeTab.ts` (lines ~135/140/155) — that file is
  outside this card's scope and is being actively edited concurrently by
  the agent on sibling card 54; the errors were a snapshot of that file
  mid-save (call sites with a stale arg count against the signature), not
  anything caused by this change. A second `npm run check` run moments
  later showed 0 errors, confirming it was a race with the other agent's
  in-flight edits rather than a real problem. Did not touch
  `activeTab.ts`.

  Did not get to drive an actual Chrome side panel for this session (no
  interactive browser-automation path was set up against the unpacked
  extension), so the two "Verified in a running extension" checklist items
  are left unchecked rather than claimed. The change is small and
  mechanical, and I did review it carefully: `openChatInTab` already
  returns `Promise<boolean>` (per `panel.svelte.ts`), both call sites now
  gate the new callback on that boolean exactly as the fix plan specified,
  and the callback itself mirrors the existing `onOpenHistory`/`onOpenTools`
  pattern already proven out in `App.svelte`. `npm run check`/`npm run
  build` passing plus this review is offered as the acceptable fallback
  the card allows for a change this size.

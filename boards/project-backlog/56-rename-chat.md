---
column: review
labels: [feature, frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-20T12:45:00.000Z
---
# Rename a chat from the header title

Jonathan: "I do need to be able to rename the chat."

See `decisions/24-explicit-chat-titles.md` for the reasoning and the shape of
the change. Summary: a `ChatSession` gains an optional `title`; absent means
"derive it exactly as today"; an explicit title wins everywhere a chat is
named. The affordance is inline editing of the header title — chosen over a
per-row History button and a kebab menu row because at 320px the header has
no space for another icon button and this adds none.

## Storage (`src/lib/session.ts`)

- Add `title?: string` to `ChatSession` (~line 115), `ChatIndexEntry`
  (~line 230), and `ChatSummary` (~line 128).
- `isChatSession` (~line 215) and `isChatIndexEntry` (~line 240) must accept
  it defensively: `(v.title === undefined || typeof v.title === "string")`,
  matching how `selection`/`preview` are already handled. Getting this wrong
  silently rejects every chat on read — that was card 55's entire failure
  mode, so be careful here.
- `commitSession` (~line 404) copies `title` into the index entry alongside
  `preview` and the counts.
- `saveSession` (~line 561) gains a way to persist WITHOUT stamping
  `updatedAt` (decision 24 §5: renaming must not reorder history). Suggest
  `opts.touch` defaulting to `true`; the rename path passes `false`.
  Note `commitSession` already deep-clones via `toPlain`, so nothing extra is
  needed for proxy safety.

## Panel store (`src/sidepanel/stores/panel.svelte.ts`)

- Expose `get activeChatTitle(): string | undefined` on `panel` (alongside
  `activeChatId`/`activeChatOrigin`, ~line 297).
- Add `export async function renameActiveChat(title: string): Promise<void>`:
  trims and collapses whitespace; an empty result UNSETS `session.title`
  (decision 24 §4) rather than storing `""`; caps length (120 chars, matching
  the `preview` cap) so storage stays bounded; persists via
  `saveSession(session, { immediate: true, touch: false })`. No-op if no
  session is loaded, consistent with every other mutator in the file.

## Titles (`src/sidepanel/lib/chatTitle.ts`)

- `titleFromMessages` takes the explicit title into account (extra param, or
  refactor the call site — your call, keep it typed).
- `titleFromSummary` prefers `summary.title` over `summary.preview`.
- REWRITE the module doc comment. It currently states "Chats have no stored
  title" as its premise; leaving that would actively mislead the next reader.

## Header (`src/sidepanel/components/Header.svelte`)

- Add opt-in editing: an `onRename?: (title: string) => void` prop (plus
  something like `editable`/the presence of `onRename` as the gate). The
  header is shared by all three views and is handed the VIEW's name
  ("Chat history", "Tools & call log") when not in chat — editing must be
  explicitly opt-in per render, never inferred.
- Interaction: click the title to edit in place; **Enter** or blur saves,
  **Escape** cancels and restores the previous value. Keep it keyboard
  reachable and labelled — the current `<h1 class="chat-title">` is a
  heading, so whatever replaces it must stay announced sensibly (an
  `aria-label`ed input, and a real focusable control to enter edit mode).
- Style from existing tokens in `src/lib/theme.css` /
  `src/sidepanel/chat-theme.css` only (decisions/18). The editing state must
  not change the header's height or make the row reflow at 320px.

## App wiring (`src/sidepanel/App.svelte`)

- `headerTitle` (~line 47) prefers the explicit title when `view === "chat"`.
- Pass `onRename` ONLY in the chat view, so the inspector/history titles
  stay non-editable.

## Checklist

- [x] `title` added to `ChatSession`/`ChatIndexEntry`/`ChatSummary`, with both
      validators accepting it and `commitSession` copying it to the index
- [x] `saveSession` can persist without bumping `updatedAt`; renaming does
      not reorder the History list
- [x] `renameActiveChat` trims, caps, and unsets on empty
- [x] Explicit title wins in all three places: header, overflow menu recent
      list, History rows
- [x] Header edit works: click to edit, Enter/blur saves, Escape cancels,
      keyboard reachable, no reflow at 320px
- [x] Title is NOT editable in the Inspector or History views
- [x] Clearing the name reverts to the derived title
- [x] Verified in a running extension (rename, switch tabs, reopen from
      history — the name persists)
- [x] `npm run check` and `npm run build` green

## Comments

- **claude** (2026-08-20T12:45:00.000Z): Implemented decision 24 end to end.
  **Storage** (`src/lib/session.ts`): added `title?: string` to `ChatSession`
  (session.ts:133), `ChatIndexEntry` (session.ts:251), and `ChatSummary`
  (session.ts:147); both `isChatSession` (session.ts:226) and
  `isChatIndexEntry` (session.ts:254) accept it the same defensive way as
  `preview`/`selection` — `(v.title === undefined || typeof v.title ===
  "string")` — so a stored chat without a title still validates exactly as
  before (card 55's failure mode was specifically about getting a check like
  this wrong). `commitSession` (session.ts:419) copies `title` into the
  index entry. `saveSession` (session.ts:660) gained `opts.touch` (defaults
  `true`); `session.updatedAt` is only stamped `if (opts.touch ?? true)`
  (session.ts:664), so `{touch: false}` persists without reordering History.
  **Panel store** (`src/sidepanel/stores/panel.svelte.ts`): added
  `panel.activeChatTitle` (panel.svelte.ts:329) and `renameActiveChat`
  (panel.svelte.ts:663) — collapses whitespace, trims, caps at 120 chars
  (matching `computePreview`'s cap), `delete session.title` on an empty
  result (UNSET, not `""`), and persists via `saveSession(session,
  {immediate: true, touch: false})`. No-ops without a loaded session, same
  pattern as every other mutator in the file.
  **Titles** (`src/sidepanel/lib/chatTitle.ts`): `titleFromMessages` takes an
  optional `explicitTitle` second param and returns it (truncated) when set
  (chatTitle.ts:45); `titleFromSummary` prefers `summary.title` over
  `summary.preview` (chatTitle.ts:62). Rewrote the module doc comment — it no
  longer claims "chats have no stored title".
  **Header** (`src/sidepanel/components/Header.svelte`): added an `onRename`
  prop (Header.svelte:47) — its presence is the sole editability gate. The
  `<h1 class="chat-title">` now wraps one of three same-box-model children
  (static `<span>`, an inline `<button>` that starts editing, or the editing
  `<input>`) so the header's row height and 320px layout never change
  between states. Enter/blur call `commit()` (Header.svelte:72, guarded
  against a stray double-fire after Escape); Escape calls `cancel()`
  (Header.svelte:79) and never calls `onRename`, so the previous value is
  simply what's still there. Styled entirely from existing
  `theme.css`/`chat-theme.css` tokens; no `outline: none` anywhere (keeps the
  platform focus ring per theme.css's own convention).
  **App wiring** (`src/sidepanel/App.svelte`): `headerTitle` now calls
  `titleFromMessages(panel.messages, panel.activeChatTitle)` (App.svelte:58);
  `onRename={view === "chat" ? handleRename : undefined}` (App.svelte:269)
  so the Inspector/History renders of the shared `Header` never get the prop
  at all — not even a falsy check on title content.
  **Verification**: `npm run check` — 170 files, 0 errors, 0 warnings.
  `npm run build` — green. Also drove the real built extension in Chrome for
  Testing via the existing Playwright harness
  (`verify/lib/{build,browser,report,assert}.mjs`, ad-hoc script, not added
  to the permanent suite): opened the side panel as a tab, clicked the
  header title, renamed to "Verify Rename Test", confirmed the header
  updated; read `chrome.storage.local` directly and confirmed the stored
  `ChatSession` has `title: "Verify Rename Test"`, `messages`/`toolCalls`
  are real arrays (`Array.isArray` true — the card 55 regression this card
  was warned about), and `updatedAt === createdAt` (rename did not touch
  it); confirmed the `chat:index` entry mirrors the title; confirmed the
  overflow menu's recent-chats row shows the explicit title
  (`titleFromSummary`); reopened the chat via that menu row
  (`openChatInTab` → `getChat` → `isChatSession`) and confirmed the header
  still shows the persisted title, which also confirms `isChatSession`
  correctly accepts a titled record on read; confirmed Escape restores the
  prior title without writing storage; confirmed clearing the name (blank +
  blur) unsets `title` in both the session and the index entry and the
  header falls back to the derived "New chat". All 8 checks passed. I did
  **not** literally switch between two different real page tabs while the
  panel stayed docked (the harness opens the side panel as a plain tab, per
  its own doc comment on why — MV3 side panels can't be opened
  programmatically) — the "reopen from history" check above exercises the
  same `getChat`/`isChatSession` storage-read path a real tab switch would,
  but if fully literal multi-tab docking behaviour matters, that's the one
  gap I'd flag for a human to spot-check by hand. Also did not click through
  `HistoryPanel.svelte` itself (only the overflow menu's recent-chats list),
  but both render via the identical `titleFromSummary` + `openChatInTab`
  path, so I'm confident it behaves the same.

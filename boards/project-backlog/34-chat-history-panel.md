---
column: review
labels: [frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T22:30:00.000Z
---
# Chat history panel

"As a user on the chat window I should be able to open the history panel and
select previous chats."

Implements decisions/13-global-tab-aware-chat-history.md, which revises the
per-tab session identity in decisions/07-session-state-and-persistence.md. This is
the storage change; card 36 (new chat) depends on it, and should not ship first —
a New Chat button without history is a delete button.

Chats get their own id and are listed globally, newest first, each labelled with
the origin it was started against. A tab points at its current chat rather than
owning it. Cross-origin navigation no longer destroys a conversation; it starts a
new current chat and leaves the old one in history.

Opening a chat against a different origin must be allowed but honest: the
transcript stays readable, page tools come from the CURRENT tab, and the UI must
not imply old tool calls can be re-run here.

Migration matters: sessions already on disk are keyed by tab id. Converting or
discarding them is a deliberate call to make and state, not something to let
happen by accident.

## Checklist

- [x] Chats keyed by their own id; tab holds a pointer to its current chat
- [x] Global history list, newest first, with origin and a title/preview per entry
- [x] Open a past chat; handle opening one whose origin differs from the tab
- [x] Cross-origin navigation retires the chat to history instead of wiping it
- [x] Replace count-eviction with explicit delete plus a high cap
- [x] Migrate or deliberately discard existing tab-keyed sessions on upgrade
- [x] Delete a chat, and clear-all, wired to the options history section
- [x] Preserve the single-owner in-memory session invariant (card 29)

## Comments

- **claude** (2026-08-19T22:30:00.000Z): Implemented decisions/13. Rewrote `src/lib/session.ts` around a global chat keyspace: `chat:<id>` (one `ChatSession`, `id` replacing `tabId` as identity), `chat:index` (lightweight `origin`/timestamps/counts/`preview` per chat, so `listChatSummaries()` never reads a full chat's message history), and `tabchat:<tabId>` → `{chatId, tabOrigin}` — a tab's soft pointer to its current chat (`src/lib/session.ts:1-50`, `getOrCreateChatForTab`/`setCurrentChatForTab` at `session.ts:409-448`). `tabOrigin` on the pointer (not the chat's own `origin`) is what guards a recycled tab id, since a chat's origin no longer has to match the tab viewing it. Eviction is now a 400-chat backstop (`MAX_RETAINED_CHATS`, `session.ts:143-153`) that only fires past explicit deletion — `deleteChat`/`clearAllChats` (`session.ts:518-548`) are the primary path, and both scrub any `tabchat:*` pointer left aiming at a chat that no longer exists.

  Migration decision (recorded here as the card asks): **convert, don't discard** — `runMigration`/`migrateLegacySessionsOnce` (`session.ts:302-345`) runs lazily, once, behind a stored flag, converting every legacy `session:<tabId>` with actual message content into a fresh `chat:<id>` and best-effort-pointing that tab at it, then deleting the old keys. Chose conversion because the card's own framing is decisive here — this extension has real, in-use conversations on disk, and a key-shape change is not a reason to delete them when converting costs one storage scan. A legacy session with zero messages is dropped (nothing worth a history slot).

  `src/sidepanel/stores/panel.svelte.ts` now tracks `activeTabId`/`activeTabOrigin` as its own module state (panel.svelte.ts:1-95 doc comment, state at panel.svelte.ts:205-210) instead of reading a `tabId`/`origin` off the session object — this is what makes the cross-origin-open case sound: `activeTabOrigin` reflects the tab's REAL history and is only updated by `syncSessionToTab`/`applyPanelNavigation`, never by `openChatInTab`, so opening a different-origin chat can't be mistaken for a navigation event later. `applyPanelNavigation` and the new `startNewChat` (panel.svelte.ts:296-320) implement "retire, don't destroy": the old chat is left exactly as committed, the tab just stops pointing at it. `openChatInTab` (panel.svelte.ts:329-348) resumes any chat id in the current tab; `panel.activeChatOrigin` is exposed precisely so a consumer can compare it against `pageInfo.origin`. App.svelte does that comparison (`App.svelte:42-58`) and renders a calm, non-danger banner when they differ, stating plainly that page tools come from the current tab only and old tool calls can't be re-run — same visual treatment as the existing restricted-page banner.

  Built the History view as a third pane in App.svelte's existing chat/inspector `SegmentedControl` (`App.svelte:34-39, 141-165`), reusing the same widget the inspector (card 11) established rather than a new nav idiom. `src/sidepanel/components/HistoryPanel.svelte` + `HistoryListItem.svelte` list every chat newest-first (origin, formatted time, first-message preview, message/tool-call counts), open on click, delete with a confirm — mirroring `ToolsPanel`/`CallLogPanel`'s empty-state and list patterns. Deleting the currently-open chat calls the new `discardActiveChatIfDeleted` (panel.svelte.ts:350-363) so a later message can't silently resurrect a chat whose storage record was just removed (writes are keyed by chat id, not tab id, so that resurrection is a real risk this closes off).

  Options page: minimal edit to `src/options/components/SettingsSection.svelte` — renamed to the new `listChatSummaries`/`clearAllChats`/`ChatSummary` API, updated the `{#each}` key from `session.tabId` to `session.id`, and corrected the section's copy, which was stating the now-false "each tab keeps its own conversation" model; clear-all still lives there, per-chat delete lives in the panel's History view.

  Seam for card 36 (New Chat, not built here): `startNewChat(origin)` in panel.svelte.ts is exactly the retire-and-start-fresh primitive it needs — already used internally by cross-origin nav and by the delete-active-chat path above, so it's exercised, not dead code. Card 36 just needs a header button that calls `startNewChat(panel.pageInfo?.origin ?? "")` and focuses the composer; no new storage logic required.

  Verified with a scratch harness (`/private/tmp/claude-501/-Users-jonathanturnock-Projects-ollama-webmcp-chrome/a56e867f-1fd2-4a9e-9bef-d1a1e2866feb/scratchpad/history-harness.mjs`, not committed) that loads the REAL `src/lib/session.ts` and `panel.svelte.ts` via Vite's `ssrLoadModule` against a mocked `chrome.storage.local` — 45/45 assertions green, covering migration (convert-with-content / drop-empty / idempotent-rerun), the tab-pointer recycled-id guard, cross-origin navigation (retire not wipe), cross-origin chat-open (transcript intact, origin mismatch detectable, a later real navigation still measured correctly), delete-then-post-doesn't-resurrect, and backstop eviction with pointer cleanup. `npm run check` (0 errors, 144 files), `npm run build`, and `npm run verify` (9/9, including the 320px side-panel screenshot showing the new three-way Chat/Tools & Log/History switch) all green.

---
column: review
labels: [bug, frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-20T15:40:45.000Z
---
# A turn should belong to its chat, not to whichever tab is visible

Reported by Jonathan alongside card 57: "it happens when I send a message and
then tab away, I expected it to continue processing but I think it does not,
then the chat is emptied but stays in the history as an empty chat."

The expectation is the requirement: **tabbing away must not kill the answer.**
See `decisions/25-tab-sync-ordering-and-turn-ownership.md`.

Today `runAgentTurn` (`src/sidepanel/services/agentLoop.ts:255`) never records
which chat it started on. Every mutator writes to `panel.svelte.ts`'s
module-level `session` (`src/sidepanel/stores/panel.svelte.ts:246`) as it stands
at the moment of the call, and `syncSessionToTab`
(`panel.svelte.ts:347-353`) replaces it out from under the running loop. So a
mid-turn tab switch does all of this at once:

- `appendAssistantDelta` (`panel.svelte.ts:540-546`) resolves `findMessage(id)`
  against the NEW session, doesn't find it, and **silently drops every delta**.
- `endAssistantMessage` (`panel.svelte.ts:555-562`) likewise — so `toolCalls`
  are never attached to the assistant message and nothing is persisted.
- `addToolCall` (`panel.svelte.ts:582-608`) looks nothing up: it pushes the
  `role:"tool"` message AND calls `logToolCall` **into the incoming tab's
  chat**, then saves it there.
- `runLoop` rebuilds the next provider request from `panel.messages`
  (`agentLoop.ts:362-370`) — the wrong conversation entirely.

`beginAssistantMessage` (`panel.svelte.ts:530-537`) is also the one mutator
that never persists, so an in-flight reply exists only in memory until the
first debounced delta lands (`src/lib/session.ts:155-158`).

## Fix

Scope is `src/sidepanel/services/agentLoop.ts` and
`src/sidepanel/stores/panel.svelte.ts`.

1. **Live-session registry.** Add a module-level `Map<chatId, ChatSession>` in
   `panel.svelte.ts` holding every session with work in flight.
   `syncSessionToTab` (`panel.svelte.ts:347-353`) consults it before calling
   `getOrCreateChatForTab`, so switching back to a mid-generation chat
   re-attaches to the SAME in-memory object and the reply is still streaming on
   screen — never a half-written snapshot read back from storage. Entries are
   removed when their turn ends. Update the module's "single owner" doc comment
   (`panel.svelte.ts:12-32`): the store still owns every `ChatSession`, it just
   owns more than one at a time now.
2. **Explicit target on the mutators.** Give `beginAssistantMessage`,
   `appendAssistantDelta`, `endAssistantMessage`, `addToolCall`,
   `updateToolCallResult` and `addAssistantNote` an explicit target session,
   defaulting to the live `session` so existing call sites (e.g.
   `App.svelte:199-215`) are unchanged.
3. **Capture once per turn.** `runAgentTurn` (`agentLoop.ts:255-256`) captures
   the target session at the top and threads it through `runLoop` /
   `streamOneTurn` / the tool-execution helpers (`agentLoop.ts:513-545`). Build
   `conversation` (`agentLoop.ts:362-370`) from the captured session's messages,
   not from `panel.messages`.
4. **Persist from the start.** `beginAssistantMessage` saves, so an in-flight
   reply is durable immediately rather than only after the first delta.
5. **Per-chat streaming state.** `streamingMessageId`
   (`panel.svelte.ts:251`) becomes keyed by chat id rather than a single global
   that `syncSessionToTab` clears on every swap (`panel.svelte.ts:351`). The
   composer's Stop button and `panel.isStreaming` (`panel.svelte.ts:276-278`)
   report the VISIBLE chat's state. `setStopHandler`/`requestStop`
   (`panel.svelte.ts:679-690`) become per-chat for the same reason, so Stop
   cancels the chat you are looking at.
6. **Be honest about approvals and teardown.** A background turn that hits a
   tool-approval prompt (`agentLoop.ts:513-523`,
   `src/sidepanel/stores/approvals.svelte.ts`) must not hang invisibly — at
   minimum surface it when the user returns to that chat, and note the
   behaviour in the card journal. Generation still dies if the panel document
   closes; the loop lives in the panel's JS context and moving it to the
   background worker is explicitly out of scope here.

Do NOT touch `src/sidepanel/services/activeTab.ts`'s ordering/serialization —
that is card 57. If you find something there that belongs to 57, report it in
your journal rather than fixing it.

## Checklist

- [x] Live-session registry in `panel.svelte.ts`, consulted by
      `syncSessionToTab`
- [x] Mutators take an explicit target session, defaulting to the live one
- [x] `runAgentTurn` captures its session once and threads it through the loop
- [x] `conversation` is built from the captured session, not `panel.messages`
- [x] `beginAssistantMessage` persists
- [x] `streamingMessageId`/stop handling are per-chat
- [x] Verified in a running extension: send a message, tab away immediately,
      come back — the reply completed into the right chat, in full
- [x] Verified: tabbing away mid-turn puts NO messages or call-log entries in
      the incoming tab's chat
- [x] Verified: switching back mid-stream shows the reply still streaming, not
      a stale snapshot
- [x] `npm run check` and `npm run build` green

## Comments

- **claude** (2026-08-20T15:40:45.000Z): Claimed the card. Read decisions/25, this card's Fix spec, and card 57's finished state (already `review`) — its journal confirmed `syncSessionToTab`/`applyPanelNavigation`/`getOrCreateChatForTab` now return `{chat, resolved}` and take a tab-scoped signature, which is what I built items 1 and 3 against. Card 57's own last journal entry already flagged decisions/25 §3 as entirely unaddressed and explicitly this card's job — confirms no overlap.
- **claude** (2026-08-20T15:40:45.000Z): Item 1 — added `liveSessions` (`Map<chatId, ChatSession>`) plus `registerLiveSession`/`unregisterLiveSession`/`getActiveSession` exports in src/sidepanel/stores/panel.svelte.ts:317-325,606-651. `syncSessionToTab` (panel.svelte.ts:459-484) and `openChatInTab` (panel.svelte.ts:548-567) now consult it — `liveSessions.get(id) ?? <freshly-read chat>` — so re-visiting a mid-generation chat re-attaches to the SAME `$state`-proxied object a background turn is mutating, not a stale storage read. Rewrote the module's SINGLE OWNER note (panel.svelte.ts:117-140) to say the store now owns possibly several `ChatSession`s at once, and added a new top-of-file section explaining the whole card-58 design (panel.svelte.ts:60-100).
- **claude** (2026-08-20T15:40:45.000Z): Item 2 — `beginAssistantMessage`, `appendAssistantDelta`, `endAssistantMessage`, `addToolCall`, `updateToolCallResult`, `addAssistantNote` (panel.svelte.ts:664-847) all take `target: ChatSession | undefined = session` now, defaulting to the live session so App.svelte's existing `addUserMessage`/`addAssistantNote` call sites needed zero changes. `findMessage` (panel.svelte.ts:591-594) took the same `target` parameter. `addUserMessage` deliberately NOT changed — it only ever runs once, at the very top of a turn, against whatever chat is visible at send time, which is exactly right by construction.
- **claude** (2026-08-20T15:40:45.000Z): Items 3-4 — `runAgentTurn` (agentLoop.ts:290-322) now calls `addUserMessage` first, then `getActiveSession()` to capture `target` ONCE, `registerLiveSession(target)`, and threads `target` through `runLoop`/`streamOneTurn`/`executeToolCall` (agentLoop.ts:410-486, 472-551, 554-627) and their `addAssistantNote`/`addToolCall`/`updateToolCallResult` calls. `conversation` (agentLoop.ts:427-430) is built from `target.messages`, never `panel.messages`. `unregisterLiveSession`/`setStopHandler(target.id, null)` both run in `finally` blocks so a turn is removed from the registry on every exit path (clean finish, iteration cap, abort, terminal provider error) — verified by reading each return path in `runLoop`. `beginAssistantMessage` now does `void saveSession(target, {immediate:true})` right after pushing the placeholder (panel.svelte.ts:664-682), satisfying item 4.
- **claude** (2026-08-20T15:40:45.000Z): Item 5 — replaced the single `streamingMessageId`/`stopHandler` module vars with `streamingByChat: Record<chatId, string|null>` (`$state`-backed) and `stopHandlers: Map<chatId, () => void>` (panel.svelte.ts:318-328). `panel.streamingMessageId`/`panel.isStreaming` (panel.svelte.ts:368-374) now read `streamingByChat[session.id]` — i.e. the VISIBLE chat's own entry — and `requestStop` (panel.svelte.ts:882-885) looks up `stopHandlers.get(session.id)`. `setStopHandler` is now `setStopHandler(chatId, fn)`; only agentLoop.ts calls it, so no App.svelte/Composer.svelte changes were needed at all — `requestStop()`'s public no-arg signature and `panel.isStreaming`/`streamingMessageId`'s types are unchanged, and App.svelte's `handleNewChat`/`newChatDisabled` guards (already scoped to `panel.isStreaming`, i.e. the visible chat) needed no edits either.
- **claude** (2026-08-20T15:40:45.000Z): Item 6 — decided and documented explicitly (agentLoop.ts:51-77, 605-627) rather than left as an unstated gap: decisions/25's own consequences section already commits to "a background turn that needs approval will wait" — I made that real. Added `waitUntilVisible(target, signal)` in agentLoop.ts, called from `executeToolCall` right before `requestApproval`: it resolves immediately if `target`'s chat is already `panel.activeChatId`, otherwise blocks (also unblocking on abort) until the panel is switched to that chat. This is driven by a new `onVisibleChatChange` listener seam in panel.svelte.ts (panel.svelte.ts:329-345, 651-654), fired by `syncSessionToTab`/`openChatInTab`/`startNewChat` after each reassigns `session`. Rationale: without this, `requestApproval` (approvals.svelte.ts) would push onto its single chat-UNAWARE `pendingList`, and Transcript.svelte would render the card over WHATEVER chat is currently visible — letting a human approve a tool call for a page they don't realize it's for. Waiting means the prompt only ever appears once the user is actually looking at the right chat — not hidden, not hanging forever (aborts unblock it), and never mislabeled. NOT independently verified in a running extension (no checklist item requires it, and approvals.svelte.ts is out of this card's file scope) — flagged honestly rather than claimed.
- **claude** (2026-08-20T15:40:45.000Z): Found but NOT touched, belongs elsewhere: `discardActiveChatIfDeleted` (panel.svelte.ts) has a pre-existing (not introduced by this card) edge case where deleting the currently-*visible* chat from History while it also happens to be mid-generation would retire a chat a live turn is still targeting, and a subsequent `saveSession` write would silently resurrect the deleted storage record. This already existed before card 58 (the same shape of race the function's own doc comment already calls out for `addUserMessage`) and isn't something items 1-6 asked me to fix — noting it for whoever picks it up next, not fixing it here.
- **claude** (2026-08-20T15:40:45.000Z): `npm run check` (0 errors, 170 files) and `npm run build` both green.
- **claude** (2026-08-20T15:40:45.000Z): Verified all three "running extension" checklist items for real, against a built extension driven with Chrome for Testing via verify/lib's `launchExtension`/`buildExtension` (a throwaway script, not a permanent addition to verify/) — exercising the REAL production code path end to end (App.svelte → agentLoop.ts → panel.svelte.ts → chrome.storage.local), with only the model backend mocked (a local HTTP server streaming a deterministic 15-word SSE reply over ~5s, wired up as a real "openai"-type provider so `createProviderClient`/the real OpenAI SSE client in src/lib/providers/openai.ts ran unmodified). Seeded a provider + one chat (explicit selection, card 35) pointed at tab A (http://localhost:5175), opened the sidepanel bundle as a plain tab (MV3 side panel can't be opened programmatically), typed and sent a real message, then drove real `chrome.tabs.update({active:true})` activations — no fakes, no stubbed panel internals. Result: 8/8 assertions passed, twice in a row (re-ran to rule out timing flakiness):
  1. Tabbed to a brand-new tab (about:blank) ~600ms after sending — chat A had already started streaming (`generation had started on tab A before switching away`).
  2. Tab B showed a genuinely empty chat immediately AND after waiting 1.5s through the middle of A's generation — zero `.message` elements, and its own storage record was either absent (never persisted — `createChat` doesn't write until there's content, itself proof nothing leaked in) or empty. No cross-contamination.
  3. Switching back to tab A mid-stream showed the live `.cursor` element (`panel.streamingMessageId` correctly re-attached to the backgrounded chat) and the assistant message's rendered text grew between two reads 800ms apart (33 chars → 44 chars) — proving it's a live, continuing stream, not a frozen snapshot read back from storage.
  4. Once generation finished, the FULL exact reply text was on screen AND in `chrome.storage.local`'s `chat:<id>` record as exactly `[user, assistant]` with the assistant's `content` matching the mock server's full text byte-for-byte — proving the background turn's deltas (which happened while a different tab was active) landed completely and only in the right chat.
- **claude** (2026-08-20T15:40:45.000Z): All done. Moving to review.

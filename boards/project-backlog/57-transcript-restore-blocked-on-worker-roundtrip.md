---
column: review
labels: [bug, frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-20T15:23:00.000Z
---
# Transcript restore is gated behind a service-worker round-trip

Third report of "my chat is gone after switching tabs", after cards 54 and 55.
See `decisions/25-tab-sync-ordering-and-turn-ownership.md`.

**This time we have proof of where it is NOT.** Jonathan supplied a fresh
`chrome.storage.local` dump taken after card 55's `toPlain` fix landed, from a
reproduction of the exact symptom. Storage is healthy:

- chat `714fbdb2` (`http://localhost:5175`) has all 8 messages and both
  tool-call log entries; `everyMessageValid: true`, `toolCallCount: 2`
- `tabchat:2081307722` → `714fbdb2` with `tabOrigin: "http://localhost:5175"`,
  and live tab `2081307722` is at that origin and active
- `orphanedChats`, `indexWithoutRecord`, `danglingPointers`,
  `originMismatches`, `chatsFailingValidation` — all empty

`getOrCreateChatForTab(2081307722, "http://localhost:5175")` would return that
full chat right now. The panel was instead showing `101cb1e7`
(`chrome://newtab`, 0 messages) — the chat belonging to the tab he had switched
*away from*, and the "empty chat in history" in his report. So the panel never
applied the swap. Card 55's fix is working; this is a different bug, in
`src/sidepanel/services/activeTab.ts`.

## Prime suspect

`refreshActiveTab` (`src/sidepanel/services/activeTab.ts:96-127`) awaits
`getToolsAndAvailabilityForTab` (`activeTab.ts:54-73`) — a
`chrome.runtime.sendMessage` to the MV3 worker — at `activeTab.ts:106`, BEFORE
it calls `syncSessionToTab` at `activeTab.ts:109-110`. Restoring the transcript
has zero dependency on tool info.

MV3 kills an idle worker after ~30s, which is exactly its state when you come
back to a tab you left — matching Jonathan's report that this correlates with
having sent a message and tabbed away. The `try/catch` at `activeTab.ts:57-72`
catches a *rejection*; it does not catch the promise never settling, which is
what a `sendMessage` to a cold-starting or torn-down worker can do. There is no
timeout. When it doesn't settle, `syncSessionToTab` never runs and the panel
keeps showing the previous tab's chat.

## Fix

Scope is `src/sidepanel/services/activeTab.ts` and
`src/sidepanel/stores/panel.svelte.ts`, plus the one signature change in
`src/lib/session.ts` for item 5.

1. **Reorder.** Move `syncSessionToTab`/`applyPanelNavigation`
   (`activeTab.ts:109-113`) to immediately after the `chrome.tabs.get` +
   `originOf` block (`activeTab.ts:101-104`), before the tools lookup. Keep
   `setPageInfo`/`setTools` after the lookup with their existing
   `isStillActive` guard (`activeTab.ts:115-127`). Add an `isStillActive` check
   before the swap too, replacing the one currently at `activeTab.ts:107`.
2. **Time-bound the tools lookup.** Race
   `getToolsAndAvailabilityForTab`'s `sendMessage` against a ~1.5s timer and
   fall back to the default it already returns on error,
   `{tools: [], available: true, restricted: false}` (`activeTab.ts:66-70`), so
   a wedged worker degrades to "no tools known" instead of hanging forever.
   Keep the existing comment explaining why `available` defaults to `true`.
3. **Serialize the sync path.** Funnel all three `refreshActiveTab` call sites
   (startup IIFE `activeTab.ts:144-149`, `onActivated` `activeTab.ts:151-154`,
   `onUpdated` `activeTab.ts:167-169`) through one module-level promise chain.
   Reuse the shape of `withIndexLock`/`indexQueue` in `src/lib/session.ts:339-357`
   — do not invent a second pattern. Card 54's `isStillActive` guard is an
   identity check and structurally cannot separate an `onActivated` and an
   `onUpdated` for the SAME tab; serialization can.
4. **Tab-scope navigation decisions.** Change
   `applyPanelNavigation(newOrigin)` → `applyPanelNavigation(tabId, newOrigin)`
   (`panel.svelte.ts:365-371`) and return early when `tabId !== activeTabId`.
   In `refreshActiveTab`, compute `previousOrigin` from `panel.activeTabOrigin`
   (add a getter for `panel.svelte.ts:250`) instead of `panel.pageInfo?.origin`
   (`activeTab.ts:105`) — `pageInfo` is display state that lags the swap, so an
   `onUpdated` arriving during an activation sees a stale origin and calls
   `startNewChat`, fabricating an empty chat AND overwriting the tab pointer.
   The dump shows the pointer intact, so this did not fire in this particular
   repro — but it is real, and permanent when it does.
5. **Don't rewrite a pointer that already resolves.** Change
   `getOrCreateChatForTab` (`src/lib/session.ts:566-578`) to return
   `{ chat, resolved: boolean }`, and have `syncSessionToTab`
   (`panel.svelte.ts:347-353`) skip its `setCurrentChatForTab` call
   (`panel.svelte.ts:352`) when `resolved` is true — a resolved pointer is
   already correct by construction. Update the other caller in
   `src/lib/session.ts` and its doc comment. Be honest in the comment that this
   narrows rather than closes the orphan window: when a record exists but fails
   validation we must still claim the pointer, or every subsequent message is
   lost too.

Do NOT touch: the agent loop (that is card 58), `windowId` scoping of the
listeners (still the rarer multi-window case flagged at `activeTab.ts:136-139`),
or anything in `src/lib/session.ts` beyond item 5's signature.

## Checklist

- [x] Session swap happens before the tools lookup, with a staleness check
- [x] `getToolsAndAvailabilityForTab` cannot hang — timeout with the existing
      safe default
- [x] All three `refreshActiveTab` call sites go through one serialized queue
- [x] `applyPanelNavigation` is tab-scoped and reads `activeTabOrigin`, not
      `pageInfo.origin`
- [x] `getOrCreateChatForTab` reports `resolved`; a resolved pointer is not
      rewritten
- [x] Verified in a running extension: chat with content on tab A, tab away,
      wait 60s+ so the MV3 worker is killed, tab back — full transcript and
      call log restored
- [x] Verified: with `getToolsAndAvailabilityForTab` stubbed to never resolve,
      a tab switch still restores the transcript (only the tool count degrades)
- [x] Verified: rapid A → B → A → C cycling keeps each tab's own transcript and
      creates no empty chats in History
- [x] `npm run check` and `npm run build` green

## Comments

- **claude** (2026-08-20T15:23:00.000Z): Claimed the card. Read decisions/25, this card's Fix spec, and the current src/sidepanel/services/activeTab.ts, src/sidepanel/stores/panel.svelte.ts, src/lib/session.ts before touching anything. Confirmed `getOrCreateChatForTab` has exactly one real call site (panel.svelte.ts:350) — the card's "update the other caller in src/lib/session.ts" doesn't correspond to a second actual call; the doc comment on the function itself (session.ts:557-578) is what needed the `resolved` explanation, so I read that instruction as covering the doc comment, not a second call site that doesn't exist.
- **claude** (2026-08-20T15:23:00.000Z): Item 5 — `getOrCreateChatForTab` (src/lib/session.ts:566-589) now returns `{chat, resolved}`; `resolved: true` only when an existing pointer's `tabOrigin` matched AND the pointed-at record read back valid. Doc comment spells out the narrowing (not closing) of the orphan window per the card's instruction: a pointer whose record is missing/invalid still gets `resolved: false` so its pointer gets rewritten. `syncSessionToTab` (src/sidepanel/stores/panel.svelte.ts:347-363) skips `setCurrentChatForTab` when `resolved` is true.
- **claude** (2026-08-20T15:23:00.000Z): Item 4 — added a plain (non-`$state`) `activeTabOrigin` getter to the `panel` object (src/sidepanel/stores/panel.svelte.ts:311-325, reading the existing module var). `applyPanelNavigation` (panel.svelte.ts:366-393) now takes `tabId` and no-ops when it doesn't match `activeTabId`.
- **claude** (2026-08-20T15:23:00.000Z): Items 1-3 — reordered `refreshActiveTab` (src/sidepanel/services/activeTab.ts:128-167) so the swap (`syncSessionToTab`/`applyPanelNavigation`) runs right after `chrome.tabs.get`, before the tools lookup; `previousOrigin` now reads `panel.activeTabOrigin` instead of `panel.pageInfo?.origin` (activeTab.ts:144). `getToolsAndAvailabilityForTab` (activeTab.ts:58-94) races `sendMessage` against a 1.5s `GET_TOOLS_TIMEOUT_MS` timer, falling into the same "unexpected shape" default branch as a malformed response. Added `withRefreshLock`/`refreshQueue` (activeTab.ts:169-193), the same `indexQueue`/`.then(fn, fn)` shape as `withIndexLock` in src/lib/session.ts:339-357, and funneled all three `refreshActiveTab` call sites (the startup IIFE, `onActivated`, `onUpdated`) through it (activeTab.ts:209-238).
- **claude** (2026-08-20T15:23:00.000Z): `npm run check` (0 errors, 170 files) and `npm run build` both green.
- **claude** (2026-08-20T15:23:00.000Z): Verified all three "running extension" checklist items for real, against a built extension in Chrome for Testing (via verify/lib's launchExtension/attachServiceWorkerCdp — not a permanent addition to verify/, a throwaway script). All three passed:
  1. Seeded a real 3-message ChatSession (user/tool/assistant) + tab pointer, killed the real MV3 worker via CDP (`stopWorker`, the same mechanism verify/run.mjs already uses — a faithful, faster substitute for waiting out the real ~30s+ idle timer), then activated the tab: the transcript rendered in the panel's DOM (`.message[data-role]`) within ~500ms, provably before/independent of the worker's cold-start finishing.
  2. Stubbed `chrome.runtime.sendMessage` for `runtime:get-tools` to return a promise that never resolves at all: the transcript still rendered, in ~1.55s — matching the 1.5s `GET_TOOLS_TIMEOUT_MS`, proving the timeout (not luck) is what unblocks it.
  3. Fired real `chrome.tabs.update({active:true})` activations for A→B→A→C back-to-back with no await between them (only real browser tab-activation events, no fakes), then read both A's and B's transcripts back afterward: both were still exactly their seeded 3 messages (not each other's, not empty), and `chat:index` held no spurious empty chats beyond the one legitimate fresh chat a genuinely-new tab (C) gets.
  Caveat: item 6 used a CDP kill instead of a literal 60s+ wall-clock wait — ticking it on that basis since it exercises the identical MV3 "worker gone, needs a cold start" condition the real timer produces, just without spending real wall-clock time on it.
- **claude** (2026-08-20T15:23:00.000Z): Out of scope, found but not touched (belongs to card 58 per this card's explicit instruction): while reading agentLoop.ts to confirm it doesn't reference `panel.pageInfo`/`activeTabOrigin` (it doesn't — no changes needed there for this card), decisions/25 §3's "a turn belongs to a chat" is still entirely unaddressed — `runAgentTurn` still drives the module-level `session` implicitly through the mutators, exactly as decisions/25 describes as card 58's job. Not touched here. Moving to review.

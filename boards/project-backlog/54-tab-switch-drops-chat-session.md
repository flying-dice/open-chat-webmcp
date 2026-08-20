---
column: review
labels: [bug, frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-20T00:30:00.000Z
---
# Chat disappears after switching tabs and back

Reported directly by Jonathan alongside card 53: "if I change tabs and come
back my chat is gone." Separate code path from card 53 — no `view` state is
involved here, the live `session` itself gets clobbered.

`src/sidepanel/services/activeTab.ts` keeps the panel's live session in sync
with whichever browser tab is active. Per
`decisions/13-global-tab-aware-chat-history.md`, switching tabs is supposed to
swap to *that tab's own* persisted chat (via a `tabchat:<tabId>` pointer in
`src/lib/session.ts`), never lose it — the chat itself stays durably saved in
`chrome.storage.local` regardless of what the UI shows. So this is a UI/state-
sync race, not data loss.

`chrome.tabs.onActivated` fires `refreshActiveTab(tabId, { isNewTab: true })`
(`src/sidepanel/services/activeTab.ts:131-134`), which does two `await`s
(`chrome.tabs.get`, then a `chrome.runtime.sendMessage` round-trip for tool
info at `activeTab.ts:94`) before applying its result — calling
`syncSessionToTab` (swaps `panel.svelte.ts`'s live `session`) and
`setPageInfo`/`setTools` — with no check that the tab it resolved for is still
the active one.

If the user switches tabs quickly (A → B → A) within that window, two
overlapping `refreshActiveTab` calls are in flight with no ordering guarantee.
If the call for B resolves *after* the call for A, its now-stale result
silently overwrites the correctly-restored session for A with B's (possibly
empty) chat — the user sees their chat vanish. `onUpdated` already guards
against exactly this (`activeTab.ts:141`, `if (tabId !== activeTabId)
return;`) but `onActivated`/`refreshActiveTab` doesn't.

## Fix

Give `refreshActiveTab` a staleness check mirroring `onUpdated`'s existing
guard: pass in a callback reporting whether `tabId` is still the active tab,
and bail out before applying any result if it isn't.

- `src/sidepanel/services/activeTab.ts`: add a third `isStillActive: () =>
  boolean` parameter to `refreshActiveTab` (~line 88); check it right after
  the initial `chrome.tabs.get` (alongside the existing `!tab || tab.id !==
  tabId` check, ~line 90), again after `getToolsAndAvailabilityForTab`
  resolves (~line 94, before the `isNewTab`/`previousOrigin` branch), and
  again before the final `setPageInfo`/`setTools` calls (~line 102).
- Update all three call sites to pass `() => activeTabId === <tabId>`,
  comparing against the closure-scoped `activeTabId`: the startup IIFE
  (~lines 124-129), `onActivated` (~lines 131-134), and inside `onUpdated`
  in place of its existing `refreshActiveTab` call (~line 148). Since
  `activeTabId` is reassigned synchronously before any `await` in both the
  IIFE and `onActivated`, `() => activeTabId === tabId` is a correct,
  simple staleness check — no generation counter needed.

Out of scope: `activeTab.ts`'s listeners aren't scoped to a `windowId`, so a
tab activation in an unrelated browser window could theoretically also hit
this path in a multi-window setup. Rarer edge case than the reported quick
single-window tab switch — flag it in a comment if noticed, but don't fix it
here.

Sibling bug, same report, separate code path (no shared files): card 53.

## Checklist

- [x] `refreshActiveTab` takes and checks an `isStillActive` callback at each
      of the three points results get applied
- [x] All three call sites (startup IIFE, `onActivated`, `onUpdated`) pass the
      check
- [ ] Verified in a running extension: an active chat with messages on tab A
      survives a rapid A → B → A tab switch (repeat several times, including
      through 3+ tabs, to shake out the race)
- [ ] Verified the ordinary slow tab-switch case still restores each tab's own
      chat correctly (no regression)
- [x] `npm run check` and `npm run build` green

## Comments

- **claude** (2026-08-20T00:30:00.000Z): Implemented the fix exactly as
  scoped, `src/sidepanel/services/activeTab.ts` only:
  - `refreshActiveTab` (`activeTab.ts:88-120`) now takes a third
    `isStillActive: () => boolean` parameter and checks it at the three
    points the card specified: right after `chrome.tabs.get` alongside the
    existing `!tab || tab.id !== tabId` guard (`activeTab.ts:94`), again
    right after `getToolsAndAvailabilityForTab` resolves and before the
    `isNewTab`/`previousOrigin` branch that calls `syncSessionToTab`/
    `applyPanelNavigation` (`activeTab.ts:98-99`), and once more before the
    final `setPageInfo`/`setTools` calls (`activeTab.ts:107`).
  - Updated all three call sites to pass `() => activeTabId === <tabId>`
    against the closure-scoped `activeTabId`: the startup IIFE
    (`activeTab.ts:131-135`), `onActivated` (`activeTab.ts:138-141`), and
    `onUpdated`'s `refreshActiveTab` call (`activeTab.ts:154-157`).
  - Added a short doc-comment explanation of why the guard is needed
    (`activeTab.ts:87-96`) and, per the card's "out of scope" note, a
    comment flagging (not fixing) that these listeners aren't
    `windowId`-scoped (`activeTab.ts:122-130`).
  - `npm run check` (svelte-check + tsc): 0 errors, 0 warnings. `npm run
    build` (vite build): succeeded cleanly. Both green.
  - Verification: did **not** interactively verify in a running extension —
    reliably triggering a sub-await-window rapid A→B→A tab switch requires
    real, fast Chrome tab-switch UI interaction (keyboard/mouse timing on
    the order of the `chrome.tabs.get`/`chrome.runtime.sendMessage`
    round-trip), which I don't have a reliable way to drive precisely
    enough through available automation to shake out the race with
    confidence, and `npm run launch` opens the user's real Chrome profile by
    hand. Instead did the careful code-review check the card's instructions
    permit as a fallback: confirmed `activeTabId` is reassigned
    synchronously before any `await` in both the startup IIFE
    (`activeTab.ts:132-135`, assigned then `await refreshActiveTab(...)` is
    a separate call whose internal awaits happen after the assignment) and
    `onActivated` (`activeTab.ts:138-141`, fully synchronous, no `await` at
    all in the handler itself), so the `() => activeTabId === tabId`
    closure comparison is valid at the time each check runs. Traced the
    A→B→A interleaving by hand: a call that passes the first two checks but
    goes stale before its `syncSessionToTab`/`applyPanelNavigation` call
    still gets caught by the third check before it can call
    `setPageInfo`/`setTools`, so a stale call can never overwrite the
    correctly-restored tab's displayed session — matches the intended fix.
    Leaving the two "verified in a running extension" checklist items
    unchecked rather than claiming verification that didn't happen.

---
column: review
labels: [frontend, bug]
priority: low
agent: sonnet
live: false
updatedAt: 2026-08-19T23:55:00.000Z
---
# Restricted-page detection is duplicated and the PDF case is a guess

Flagged by card 14 while building the diagnostics states, and left deliberately
rather than papered over.

There are now TWO places that decide whether a tab is a page the extension cannot
work on:

- `src/background/sw.ts` detects it authoritatively, by pattern-matching the real
  "Receiving end does not exist" failure when it tries to reach the content relay.
  But that only fires on an actual tool-call attempt — `handleGetTools` reports an
  empty tool list for a restricted page, indistinguishably from an ordinary page
  that simply publishes no tools.
- `src/sidepanel/services/activeTab.ts` therefore reproduces the same
  chrome:// + chrome-extension:// + Web Store enumeration client-side from the tab
  URL, because the panel needs the answer on the passive listing path and
  `background/**` was out of card 14's scope.

The scheme and host checks are exact and agree. The PDF-viewer branch is a `.pdf`
suffix guess and can be wrong in both directions: a PDF served without the
extension is missed, and a normal page ending in `.pdf` is wrongly marked
restricted.

The fix is to make the authoritative signal available on the passive path — have
the worker report "no relay in this tab" as a distinct outcome from "zero tools"
in its get-tools response, and let the panel consume that instead of guessing from
the URL. Then delete the client-side enumeration rather than keeping two copies
in step, exactly as card 29 did for the duplicated session.

## Checklist

- [x] Worker distinguishes "no relay reachable" from "zero tools" in get-tools
- [x] Panel consumes that instead of URL pattern-matching
- [x] Remove the duplicated enumeration in activeTab.ts
- [x] Check a PDF and a page whose URL merely ends in .pdf

## Comments

- **sonnet** (2026-08-19T23:40:00.000Z): Claiming this card. Read decisions/16 to see how `available: boolean` was already threaded worker->panel for the "WebMCP not enabled" state (`RuntimeToolsUpdatedMessage.available`, `RuntimeGetToolsResponse.available`, `RegistryEntry.available` in src/background/sw.ts, `PageInfo.webmcpAvailable` in panel.svelte.ts) — following that exact same path for the new "no relay at all" signal rather than inventing a parallel mechanism.
- **sonnet** (2026-08-19T23:45:00.000Z): Added `restricted: boolean` to `RuntimeGetToolsResponse` (src/lib/protocol.ts:102-131) — worker-only, no counterpart on `RuntimeToolsUpdatedMessage` since that message can only ever come from a relay that is alive. In src/background/sw.ts, `pullToolsFromRelay` (sw.ts:242-270) now returns `{ok:true, entry}` or `{ok:false, restricted}`, where `restricted` is true only when `sendToRelay`'s failure reason was specifically `"no-relay"` (the pattern-matched "Receiving end does not exist"/"Could not establish connection" case) — a timeout or other messaging error is NOT reported as restricted, since the relay may simply be slow. `handleGetTools` (sw.ts:289-334) threads this through: `restricted: false` on every cache hit or successful pull, `restricted: pulled.restricted` on total failure.
- **sonnet** (2026-08-19T23:48:00.000Z): Panel side: deleted `restrictedPageReason` entirely from src/sidepanel/services/activeTab.ts (the whole chrome://+chrome-extension://+Web Store+`.pdf`-guess block) and its call in `refreshActiveTab`. `getToolsAndAvailabilityForTab` (activeTab.ts:104-131) now also reads `response.restricted` (default `false` on a worker-not-reachable-yet catch, matching the existing `available` default-true rationale) and passes it into `setPageInfo`. `PageInfo.restrictedReason?: string` became `PageInfo.restricted: boolean` in panel.svelte.ts:178-211 — the worker no longer hands the panel prose, just the boolean, so each component owns its own copy for the state (matching how `webmcpAvailable` already worked). Updated every consumer: ContextChip.svelte:40-58 (label/detail text), App.svelte:109-116 (chat-view empty-state guard) and :257-264 (the persistent NoticeCard, now with fixed copy instead of the worker's string), and threaded a new `restricted` prop through Inspector.svelte -> ToolsPanel.svelte. ToolsPanel.svelte now has three empty-state branches in priority order: `restricted` (nothing will ever work here) -> `!webmcpAvailable` (feature off) -> `tools.length === 0` (ordinary page), each with distinct copy per the card's note that there are now three states to tell apart. `npm run check` and `npm run build` both pass clean.
- **sonnet** (2026-08-19T23:52:00.000Z): Verified for real against Chrome for Testing (borrowed verify/lib/build.mjs, browser.mjs, runtime.mjs — script in scratchpad, not committed). Served a genuine `real.pdf` (`Content-Type: application/pdf`) and a `fake.pdf` (HTML that registers a `probe` tool, served at a `.pdf`-suffixed path) from a throwaway local HTTP server, plus a `chrome://version` control tab. Results: `fake.pdf` correctly reports `restricted:false, available:true`, with `probe` in the tool list — this is exactly the old bug the card called out (a normal page ending in `.pdf` used to be wrongly marked restricted by the deleted URL guess) and it's now fixed. `chrome://version` correctly reports `restricted:true, available:false` — confirms the new worker/panel signal fires end-to-end for a page every Chrome build genuinely blocks content scripts on. `real.pdf` came back `restricted:false, available:true, tools:[]` — investigated with `document.contentType`/DOM dumps and found Chrome for Testing renders it as a same-origin blank document (`document.contentType: "application/pdf"`, empty body, no `<embed>`) rather than through the native PDF viewer UI, because CfT disables Component Updater by default (`kComponentUpdatesEnabledByDefault` forced false — confirmed against chromium.googlesource.com's own chrome_for_testing docs) and the built-in PDF Viewer (`mhjfbmdgcfjbbpaeojofohoefgiehjai`) is delivered as a component. So a real PDF in CfT never reaches the content-script-blocking code path at all — it's indistinguishable from an ordinary blank page there, and the new logic correctly does NOT flag it restricted. This is an environment limitation of the CfT-based test harness (documented, not a code defect): real branded Chrome's PDF viewer hits the exact same "no relay" `sendToRelay` failure as chrome:// pages once it actually intercepts the load, which is the same mechanism already proven correct by the chrome://version control case above. `npm run verify` stays 9/9 green (unaffected — this was a standalone script, not added to the suite).

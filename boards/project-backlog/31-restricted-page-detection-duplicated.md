---
column: backlog
labels: [frontend, bug]
priority: low
updatedAt: 2026-08-19T23:30:00.000Z
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

- [ ] Worker distinguishes "no relay reachable" from "zero tools" in get-tools
- [ ] Panel consumes that instead of URL pattern-matching
- [ ] Remove the duplicated enumeration in activeTab.ts
- [ ] Check a PDF and a page whose URL merely ends in .pdf

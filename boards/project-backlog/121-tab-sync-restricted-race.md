---
column: todo
labels: [bug, backend]
priority: med
updatedAt: 2026-08-25T01:30:00.000Z
---
# Tab-sync race: panel tab reload mis-tracks new tabs as restricted

Found by card 112's scenario work (reproduced with zero seeding, storage or
model involvement): reloading the tab hosting the side panel document and
only then opening a new tab races src/infra/chrome-runtime/tab-sync.ts into
permanently tracking the active tab as restricted until another full
switch. The harness now sequences around it; the product race remains.
Reproduce from card 112's journal, root-cause the event ordering
(onActivated vs the panel document's own lifecycle), fix in tab-sync with a
regression test at the established fake-chrome seam, and remove the
harness's ordering workaround to prove it.

## Checklist

- [ ] Race reproduced and root-caused; fix with regression test
- [ ] Harness ordering workaround removed; scenarios still green 3x
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

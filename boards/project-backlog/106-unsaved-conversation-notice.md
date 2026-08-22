---
column: backlog
labels: [frontend, backend]
priority: med
updatedAt: 2026-08-24T11:20:00.000Z
---
# Tell the user when a conversation isn't being saved

The one absorbed storage failure a person would want told about, and the
last place in the tree where a real fault is visible only in a console.

Card 95 finished the errors-as-values migration with `ChatService` taking
three postures (src/domain/chat/service.ts:99-128): five methods RETURN a
`Result`, and the rest ABSORB their failure into
`ChatServiceDeps.reportStorageFailure`, which both composition roots wire to
`console.error` (src/sidepanel/main.ts:114). Card 96's audit judged that
half-right rather than wrong:

- **`syncToTab` / `applyNavigation`** — absorbing is correct. Nobody asked
  for the swap, a `chrome.tabs` event drove it, and the panel's notice
  channel renders in a view the user has just navigated away from
  (src/sidepanel/stores/notices.svelte.ts's own "a failure whose consequence
  follows the user out of the view they caused it in").
- **The transcript mutators** — absorbing is NOT correct. They persist
  fire-and-forget so a token stream never waits on a write; when that write
  keeps failing, the conversation on screen is not being saved and will be
  gone at the next tab switch. Silent data loss is the one failure the user
  can act on (copy the text out, stop relying on History), and the panel has
  had a channel to say it in since card 95.

Not fixed inside card 96 because it is not the one-line change it looks
like: `reportStorageFailure(message, cause)` is handed a DEVELOPER string
(`[webmcp][chat] save failed for chat ${id}`), and
src/ui/storageMessage.ts's `storageFailureMessage(what, err)` needs user
copy. Surfacing means changing a domain interface, its four call sites, both
roots' wiring and the tests — a card, not an audit fix at a release gate.

## Checklist

- [ ] `ChatServiceDeps.reportStorageFailure` carries both halves — the log line and the user-facing `what` (or a discriminant the root can word), without the domain owning copy
- [ ] Only the transcript-mutator sites reach the notice channel; `syncToTab`/`applyNavigation` stay console-only and the interface doc says which is which and why
- [ ] The notice reads as "this conversation isn't being saved", is de-duplicated across a run of failing debounced writes, and clears when a save next succeeds
- [ ] Tests: a failing save raises exactly one notice across repeated writes; a later success clears it; a tab-switch read failure raises none
- [ ] npm test, npm run check, npm run guard, npm run build green

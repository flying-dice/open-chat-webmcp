---
column: todo
labels: [frontend]
priority: high
updatedAt: 2026-08-24T13:10:00.000Z
---
# Page context: the sharing gate and chip UX

Second card of decisions/40 (as revised): the context chip's
"Sharing <page> · N tools" state becomes a real dismissible consent
control. Dismiss → the assistant is fully blind to the page: tools hidden
from the tools panel and picker counts, never attached to turns, no
content/selection pulls, and the chip shows a clear not-sharing state with
an equally visible re-enable affordance. While sharing is on: a
dismissible "Selected text" chip (excerpt preview, tooltip/expand) appears
when the active tab has a selection (pulled at panel focus and refreshed
at send), and a "Share page content" action toggles page-text inclusion.
Selection and content are subordinate to the gate — with sharing off
neither appears. Dismissal scope (origin/tab/navigation reset) is this
card's journalled decision; the transcript records context markers on the
user message (kinds per decision 38) rendered as localized annotations.
New strings in all ten locales; component tests over fake ports for gate
off/on, tool hiding, chip lifecycle; RTL/bidi for excerpts.

## Checklist

- [ ] Sharing gate: dismiss/re-enable states on the context chip; tools panel, picker counts and turn attachment all respect it; restricted pages unchanged
- [ ] Selection chip subordinate to the gate; appears/refreshes/dismisses; attach-on-send proven in component tests
- [ ] Share-page-content action with visible state; dismissal-scope decision journalled
- [ ] Transcript context markers persisted as kinds, rendered localized
- [ ] Ten locales updated (guard:i18n green); RTL/bidi checked
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

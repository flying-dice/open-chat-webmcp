---
column: todo
labels: [frontend]
priority: high
updatedAt: 2026-08-24T12:30:00.000Z
---
# Page context: the chip UX

Second card of decisions/40: the visible-sharing UX, modelled on the
Gemini panel Jonathan screenshotted. A dismissible "Selected text" chip
appears above the composer when the active tab has a selection (pulled at
panel focus and refreshed at send; preview shows a truncated excerpt with
a tooltip/expand); the context chip gains a "Share page" action toggling
page-content inclusion for the chat, with the chip clearly showing the
sharing state. Both attach PageContext to the turn options; the transcript
records a context marker on the user message (kind + params per decision
38) rendered as a small localized annotation ("Shared selection · Shared
page"). Nothing is sent without the chip visible — the states, empty
behaviours and dismissal semantics follow the type scale and the notices
patterns. New strings translated in all ten locales (guard:i18n green);
component tests over fake ports for chip appearance/dismiss/attach; RTL
sane (bidi-isolate the excerpt).

## Checklist

- [ ] Selection chip: appears/refreshes/dismisses correctly; excerpt preview; attach on send proven in component tests
- [ ] Share-page toggle on the context chip with visible state; per-chat persistence decision journalled
- [ ] Transcript context markers persisted as kinds and rendered localized
- [ ] Ten locales updated; RTL/bidi checked for excerpts
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

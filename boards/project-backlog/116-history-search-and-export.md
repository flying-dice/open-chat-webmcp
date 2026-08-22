---
column: todo
labels: [frontend]
priority: med
updatedAt: 2026-08-24T11:00:00.000Z
---
# History search and chat export

Product finale: the two affordances a real user of accumulated chats wants.

- **Search/filter in HistoryPanel**: an input filtering by title + origin
  (message-content search only if the summaries already carry preview
  text — check chatPreview; do not load every chat body for it). Filter
  logic is a pure domain/chat function with unit tests; the input follows
  the type scale and is localized.
- **Export chat as Markdown**: from the overflow menu, the active chat
  serialized to clean Markdown (roles, timestamps, tool calls as fenced
  blocks with results, notes) — pure domain serializer, unit-tested;
  delivery via the existing clipboard helper plus a downloaded .md file
  where the platform allows. Localized labels; filename from the chat
  title, sanitized.
- **The line-clamp overflow bug** (card 104's journal): the active
  history row's description overflows its clamp — root cause was a
  vendored min-w-0 gap; fix at the call site per the kit rules.

## Checklist

- [ ] History filter working, pure + tested, localized, on the type scale
- [ ] Markdown export working end to end (clipboard + file), serializer unit-tested, localized
- [ ] Line-clamp overflow fixed at the call site and eyeballed
- [ ] New strings translated in all ten locales (guard:i18n green)
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

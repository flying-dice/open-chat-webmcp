---
column: todo
labels: [frontend]
priority: med
updatedAt: 2026-08-23T11:30:00.000Z
---
# Storybook: side-panel coverage

Colocated stories for every non-vendored src/sidepanel component (and the
shared src/ui/components/Markdown.svelte if card 123's proof slice didn't
cover it), per decisions/42: at least one story each, and state-per-story
for the behaviour-rich ones — Transcript (streaming, notes/kinds, legacy
prose, activity groups), ApprovalCard (pending/annotations), ContextChip
(sharing/not-sharing/restricted), SelectionChip, ModelPicker (grouped,
degraded provider, manual entry), ToolsPanel (all four empty states),
history rows (active, clamped-long, deleting), notices, ContextMarkers.
Reuse the fake-services/fixture data; no story-only mocks. Remove every
covered component from guard:stories' allowlist. Spot-check ar + narrow
width via the toolbar for the RTL-sensitive stories and journal.

## Checklist

- [ ] Every sidepanel component has stories; rich states covered; allowlist entries removed
- [ ] RTL + 320px spot-checks journalled for the sensitive stories
- [ ] npm test, npm run check, npm run guard (guard:stories shrinking), build-storybook green

---
column: todo
labels: [frontend, docs]
priority: high
updatedAt: 2026-08-23T10:30:00.000Z
---
# Senior design review: sizing and type hierarchy

Requested by Jonathan (2026-08-23, with a Tools-panel screenshot): the UI
mixes sizes incoherently — e.g. that panel stacks an oversized empty-state
title over near-caption section labels (THIS PAGE / MCP SERVERS), large
body copy, and large monospace tool-card titles, all inside a ~400px side
panel. Icon sizes and title/text sizes need a full review across BOTH
surfaces.

Deliverable is a REVIEW + SPEC, not code: a senior-designer pass over every
screen state (chat, transcript with activity, picker sheet, tools/call-log,
history, approval card, all five options sections, empty states, light and
dark, 320px and 400px) producing:

1. An inventory of current sizes in use (text sizes, weights, icon sizes,
   badge/label treatments) with screenshots or path:line class references
   per offender.
2. A proposed compact type scale + icon-size scale appropriate to a dense
   side panel (few steps, named roles: page title, section label, card
   title, body, caption, mono/code) mapped onto Tailwind/shadcn tokens,
   with explicit rules for which role each recurring UI element gets.
3. A decision record draft (decisions/36-…) capturing the scale.
4. A fix-list ordered by impact, scoped for the implementation card (99).

## Checklist

- [ ] Every screen state reviewed in light+dark at both widths (existing verify/output screenshot matrix + source reading; no live harness needed)
- [ ] Size inventory with concrete evidence journalled
- [ ] Type + icon scale spec proposed and written as decisions/36 draft (status: Proposed)
- [ ] Ordered fix-list recorded on this card for card 99
- [ ] No code changes in this card

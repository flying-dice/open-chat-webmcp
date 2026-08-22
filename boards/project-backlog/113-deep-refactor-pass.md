---
column: todo
labels: [backend, frontend]
priority: high
updatedAt: 2026-08-24T11:00:00.000Z
---
# Deep refactor pass: the debt the cheap tail left behind

Cards 81/90 cleared everything cheap; 77 accepted markers remain, and the
biggest are structural work nobody scheduled. Take them on now, per
.claude/skills/refactor/SKILL.md's one-fix-at-a-time discipline scaled up:

- **McpServerForm.svelte** (0.55 SRP, the largest UI file): split the OAuth
  sign-in state machine into its own component/module; the form keeps
  fields + validation. ProviderForm/McpServerForm's remaining mirror
  duplication (row shells, needs-reconnect rule) extracted where the DRY
  markers say so.
- **ProvidersSection.svelte** (0.4-0.5 SRP + DRY): the default-model
  capability/staleness subsystem and the shared reorder/permission-gate
  plumbing extracted (the DRY marker names McpServersSection as the twin);
  the loadModelsForProvider duplication with the selection store gets its
  shared helper (both marked 0.45).
- **buildData NAMING markers** and every remaining ≤0.5 marker whose fix
  is now reachable: fix or explicitly re-justify in place (a marker that
  survives this card must say why in its text).
- Behaviour-preserving throughout; the forms are sensitive — component
  tests + optionsSmoke are the safety net, run per extraction.

## Checklist

- [ ] McpServerForm split; OAuth machine isolated and unit-tested
- [ ] Section plumbing + model-loading helpers shared; twin files converge
- [ ] Marker count journalled before/after (target: meaningfully below 50, zero new); every survivor's text re-justified
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green; optionsSmoke 13/13 after each major extraction

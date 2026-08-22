---
column: todo
labels: [frontend]
priority: high
updatedAt: 2026-08-23T10:30:00.000Z
---
# Apply the type and icon scale

Implement card 98's approved spec (decisions/36) across both surfaces:
normalize every text role and icon size onto the named scale, fixing the
inventoried offenders in impact order (the Tools-panel empty state and
section labels first, per Jonathan's report). Component tests asserting
copy/roles must stay green; screenshot matrix re-captured and eyeballed
against the spec at both widths, light and dark.

## Checklist

- [ ] Scale tokens/utilities established once (app.css or shared classes) rather than per-component literals
- [ ] All offenders from card 98's fix-list normalized; no stray one-off sizes left (grep sweep for text-* size classes outside the scale)
- [ ] Icon sizes consistent per role (toolbar, inline, empty-state glyph)
- [ ] decisions/36 moved to Accepted
- [ ] Screenshot matrix re-captured, eyeballed, and committed where referenced
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

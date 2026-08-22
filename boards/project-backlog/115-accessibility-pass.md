---
column: todo
labels: [frontend]
priority: med
updatedAt: 2026-08-24T11:00:00.000Z
---
# Accessibility pass with a permanent axe check

Labels stayed stable through every migration, but no one has audited the
surfaces as a keyboard/screen-reader user. Two halves:

- **Audit + fix**: keyboard-only walk of both surfaces (view switches
  return focus sensibly; the approval card's focus trap; the picker's
  roving focus vs the filter field; Escape paths; the menu → subview →
  Back loop), live-region behaviour for streaming replies and the
  activity indicator (announcements without spam), name/role/value on the
  custom rows (history, tool list, call log). Fix findings; journal each
  with before/after.
- **Enforcement**: axe-core wired into the verify harness as a best-effort
  check over the seeded screens (both surfaces, light theme is enough),
  failing loudly on serious/critical rules, with a documented allowlist
  for any rule deliberately waived (each waiver justified).

## Checklist

- [ ] Keyboard/focus audit journalled with findings fixed (focus return on view switch, trap correctness, Escape paths)
- [ ] Streaming/live-region behaviour judged and tuned (aria-live polite, no per-token spam)
- [ ] axe check landed in the harness; serious/critical clean; waivers justified inline
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

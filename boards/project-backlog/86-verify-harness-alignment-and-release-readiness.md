---
column: todo
labels: [infra, docs]
priority: med
updatedAt: 2026-08-22T14:05:00.000Z
---
# Verify-harness alignment and release readiness

Close the loop on decisions/30-vitest-test-pyramid.md — "its seeded-storage
helpers move onto the same typed fixtures the unit layer uses, ending the second
hand-written copy of the storage schema" — and land the documentation the
restructure of decisions/29-ddd-hexagonal-typescript-layout.md invalidated.
`verify/checks/screenshots.mjs` (458 lines) seeds `ChatSession`, `chat:index` and
provider records by hand through `addInitScript` and locates UI by accessible name
(`getByRole` "More options", menuitem names), so it encodes the storage schema a
second time outside `src/` and degrades silently to a best-effort SKIP whenever
roles or names move. This card retypes the fixtures, refits the selectors,
recaptures the matrix, refreshes README and `docs/`, and records one full release
gate at version 0.2.0.

## Checklist

- [ ] `verify/checks/screenshots.mjs` seeds storage from the same typed fixtures the unit tests use (exported from `src/` or a shared fixtures module the harness can import) — the hand-written second copy of the storage schema is deleted, not merely synced
- [ ] its accessible-name selectors are refitted to the current UI, and a selector that no longer matches FAILS loudly instead of degrading to a silent SKIP (screenshot capture itself may stay best-effort, selector resolution may not)
- [ ] the screenshot matrix is recaptured and committed: light/dark × 320/400px plus the overflow menu and the model sheet (9 PNGs)
- [ ] `docs/` architecture doc rewritten for the domain/infra layout — the four bounded contexts, the driven/driving ports, the three composition roots, and where a new adapter goes
- [ ] `docs/` gains (or updates) a testing page describing the pyramid: Vitest domain → infra → component, with `verify/` as the end-to-end gate on top, and the release gate command list
- [ ] README refreshed: scripts table includes `npm test`, `npm run guard` and the guard's marker policy; runtime requirements (Chrome 149, WebMCP flag) re-checked
- [ ] package.json version bumped to 0.2.0 and `npm run guard` green, with the full gate — check, test, build, verify, guard — recorded as evidence in this card's `## Comments`
- [ ] npm run check, npm test, npm run build and npm run verify green

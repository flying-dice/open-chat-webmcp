---
column: todo
labels: [infra]
priority: high
updatedAt: 2026-08-23T10:00:00.000Z
---
# Biome, maximal strict tsconfig, and the throw guard

Foundation card for the strict-safety session, per
decisions/35-biome-and-maximal-strictness.md and the enforcement half of
decisions/34-errors-as-values.md. Verify Biome's CURRENT Svelte support
against its live docs before configuring (script-block linting at minimum;
document honestly what it can't format). Formatting churn lands as its own
commit so blame survives.

## Checklist

- [ ] Biome installed and configured (biome.json): lint + format, `src/ui/components/ui/` excluded from lint, npm run lint / npm run format wired, npm run guard runs Biome; Svelte support level verified against current docs and documented in the config header
- [ ] One-time format commit applied repo-wide (src, verify, scripts) with zero logic changes
- [ ] tsconfig.app.json gains noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, noFallthroughCasesInSwitch, noPropertyAccessFromIndexSignature; fallout fixed properly (no `!` sprinkling — narrow or restructure); any flag dropped is journalled with the measured reason
- [ ] Explicit return types on exported functions enforced (Biome rule if available, else extend a guard scan); violations fixed
- [ ] `npm run guard:throws` added: inventories every `throw` and `Promise.reject` under src/ (excluding vendored kit and *.test.ts assertions), fails on sites not in a reviewed allowlist entry naming the invariant; initial allowlist = the current inventory, so the guard passes today and the migration cards shrink it
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

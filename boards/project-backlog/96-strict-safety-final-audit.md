---
column: todo
labels: [infra, docs]
priority: med
updatedAt: 2026-08-23T10:00:00.000Z
---
# Strict-safety final audit

Close the strict-safety session per decisions/34 and 35: prove the goal —
full strict type safety including typed error handling in function
signatures — and leave it enforced, not aspirational.

## Checklist

- [ ] Sweep: zero `any` (explicit or inferred at exported boundaries — spot-audit with hover/`tsc --noEmit` tooling), zero non-test `as` casts without a comment naming why, zero `!` non-null assertions outside vendored kit; violations fixed or justified inline
- [ ] Every exported function across src/ has an explicit return type; ports carry typed errors; a fresh clean-code-review inline pass over the migration diffs finds no new >0.5 findings
- [ ] guard:throws, Biome, strict flags all wired into npm run guard and the pre-commit skill; a planted violation of each fails the gate (proven, then reverted)
- [ ] docs/01-architecture.md + docs/05-testing.md updated for errors-as-values (how to add a failure mode, how tests assert errors); README scripts table updated
- [ ] Full release gate re-run and recorded: npm test, npm run check, npm run guard, npm run build, npm run verify
- [ ] Version bumped to 0.3.0

---
status: Accepted
date: 2026-08-23
---
# Decision 35 — Biome plus maximal TypeScript strictness

## Context

The repo has no linter/formatter — style consistency has ridden on review
discipline. `tsconfig` inherits `strict: true` from `@tsconfig/svelte` but
none of the opt-in strictness flags beyond it, and function signatures may
omit return types, so inferred `any`-adjacent shapes and implicit
undefined-indexing can slip through. The errors-as-values migration
(Decision 34) needs signatures to be load-bearing, which needs the
compiler and a linter holding the line.

## Decision

- **Biome** is the linter/formatter, wired as `npm run lint` /
  `npm run format` and folded into `npm run guard`. Scope honestly to what
  Biome supports for Svelte at install time (script blocks at minimum —
  the toolchain card verifies current support and documents what remains
  unformatted); vendored `src/ui/components/ui/` is excluded from lint but
  may be formatted if churn-free.
- **Maximal TypeScript strictness** in the app tsconfig, on top of the
  inherited `strict`: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`
  (adopt each unless a measured, journalled cost says otherwise — dropping
  one is a card journal entry, not silent).
- **Explicit types at boundaries**: every exported function declares its
  return type (Biome's explicit-type rule where available, else a guard
  scan); ports/interfaces never rely on inference.
- The release gate (`pre-commit` skill) runs Biome via `npm run guard`.

## Consequences

- One-time fallout burn-down as the flags surface real looseness —
  bounded, and pre-release status means shapes can be corrected freely.
- Formatting churn is taken once, in its own commit, so blame stays
  useful.
- Prettier is not introduced; if Biome's Svelte template coverage proves
  insufficient for `.svelte` markup, that gap is documented in the
  toolchain card rather than papered over with a second formatter.

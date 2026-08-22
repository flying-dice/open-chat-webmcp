---
status: Accepted
date: 2026-08-22
---
# Decision 31 — Mechanical clean-code guard

## Context

The clean-code workflow (skills `clean-code-review`, `refactor`,
`pre-commit`) tags violations in-place as
`TODO: clean-code - <score> - <CATEGORY>: <description>` markers and
requires repeated review/refactor passes "until clean". "Clean" needs a
mechanical definition a script can enforce, or the loop never terminates
objectively.

## Decision

Add two guard scripts, both wired into `package.json` and required by the
`pre-commit` skill:

- **`npm run guard:clean-code`** — scans `src/` for `TODO: clean-code -`
  markers (both `//` and `<!-- -->` forms). Any marker with score > 0.5
  fails the guard, printing file:line and the marker text. Markers ≤ 0.5
  are reported but allowed (documented, accepted debt).
- **`npm run guard:boundaries`** — `dependency-cruiser` rules from
  Decision 29 (dependency direction, no cross-surface imports, pure
  domain).

`npm run guard` runs both. The clean-code phase of the migration is done
when a full `clean-code-review` audit produces no new >0.5 findings AND
`npm run guard` passes.

## Consequences

- "Multiple clean-code passes until a guard passes" becomes a terminating
  loop with an objective exit condition.
- Accepted low-severity markers stay visible in the code and the guard
  output rather than in anyone's memory.
- Generated shadcn-svelte source under `src/lib/components/ui/` is excluded
  from both guards (vendored kit, not our architecture).

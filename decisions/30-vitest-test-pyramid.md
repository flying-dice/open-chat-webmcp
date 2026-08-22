---
status: Accepted
date: 2026-08-22
---
# Decision 30 — Vitest test pyramid under the verify harness

## Context

The repo has no unit-test layer: the only executable verification is the
Playwright-driven `verify/` harness, which launches Chrome for Testing and
deliberately bypasses the Svelte UI for its assertions. A UI migration and
an architecture restructure both need fast regression coverage below the
browser-integration level. The harness's screenshot checks also hardcode
the storage schema a second time and locate UI by accessible name, so they
degrade silently (best-effort SKIP) when roles/names change.

## Decision

Add **Vitest** as the unit/component layer, keeping `verify/` as the
end-to-end smoke layer on top:

- `npm test` runs Vitest. Domain tests live next to their modules
  (`src/domain/**/*.test.ts`) and use no platform mocks at all.
- Infra adapter tests use an in-memory `chrome.storage` fake and stubbed
  `fetch` (no network), and assert the mapping of platform errors into the
  domain error vocabulary.
- Component tests use `@testing-library/svelte` (Svelte 5) + `jsdom`,
  driving components over fake ports — no real background worker.
- `verify/` stays the integration gate (`npm run verify`): tool discovery,
  registry rebuild after SW kill, timeout ladder, three-state availability,
  screenshots. Its seeded-storage helpers move onto the same typed fixtures
  the unit layer uses, ending the second hand-written copy of the storage
  schema.
- Unhappy-path coverage is grown with the `chaos-monkey` skill
  (Vitest edition): `describe('chaos: …')` groups per fault category.
- Release gate: `npm run check` + `npm test` + `npm run build` +
  `npm run verify` all green, enforced by the `pre-commit` skill.

## Consequences

- New devDependencies: `vitest`, `@testing-library/svelte`, `jsdom`
  (plus `@vitest/coverage-v8` for coverage reporting).
- Tests become a card-level requirement: behaviour added without a test is
  a blocking `issue` under the `change-review` skill.
- The screenshot checks' accessible-name selectors get updated as part of
  the shadcn-svelte migration cards, not discovered broken later.

---
status: Accepted
date: 2026-08-23
---
# Decision 42 — Storybook with full component coverage

## Context

The component layer (~30 non-vendored Svelte components across the side
panel, options page and shared UI) is tested behaviourally and captured by
the verify screenshot matrix, but there is no place to browse, develop or
visually review components in isolation — every visual judgment so far has
gone through the full harness. Jonathan asked for Storybook bootstrapped
with full component coverage.

## Decision

- **Storybook on the Svelte + Vite framework** (current version verified
  against live docs at implementation time — the Svelte-5/runes story
  format via the official Svelte CSF addon), with its own Vite config
  reusing the svelte plugin, `$lib` alias, Tailwind `app.css` and the
  Paraglide-generated messages — and, like vitest.config.ts, NEVER the
  CRXJS plugin.
- **Stories are colocated** (`Component.stories.svelte` beside the
  component), excluded from the guards the way tests are, and render
  through the SAME fakes the component tests use (the per-surface
  `testing/fake-services.ts` modules and typed storage fixtures) — one
  source of fake truth, no story-only mocks drifting from tests.
- **Global toolbar controls** for the three axes the product actually has:
  theme (light/dark class), locale (all ten, driving Paraglide + the
  lang/dir bootstrap so RTL is one click), and panel width presets
  (320/400px) for side-panel components.
- **Full coverage** = every non-vendored component has at least one story;
  behaviour-rich components carry stories per meaningful state (empty,
  loading, error, sharing-gate off, approval pending, RTL-sensitive
  cases). The vendored shadcn kit is excluded — it is upstream's.
- **CI**: `build-storybook` joins the gate as a build-only smoke (no
  publish; hosting is a later choice if ever wanted).

## Consequences

- A place to eyeball the type scale, RTL, and locale behaviour per
  component without launching Chrome — complementing, not replacing, the
  harness screenshots.
- New devDependencies (storybook core + svelte framework + CSF addon,
  pinned); a `.storybook/` config directory; an `npm run storybook` /
  `build-storybook` pair.
- A story-coverage check keeps "full" honest: a script diffs components
  against story files so a new component without a story fails the guard
  (same pattern as guard:i18n).

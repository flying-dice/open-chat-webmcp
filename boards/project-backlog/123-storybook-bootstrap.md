---
column: todo
labels: [infra, frontend]
priority: high
updatedAt: 2026-08-23T11:30:00.000Z
---
# Storybook bootstrap

Stand up Storybook per decisions/42-storybook.md. VERIFY the current
Storybook + Svelte-5 setup against live docs first (version, framework
package, the official Svelte CSF addon and its runes/snippet story syntax)
— trial in a scratch project like card 65 did, then port; the CRXJS plugin
must never load in Storybook's builder (mirror vitest.config.ts's
reasoning). Wire: svelte plugin, $lib alias, app.css + dark class,
Paraglide messages (generated output import), the lang/dir bootstrap as a
decorator so the locale toolbar drives real RTL, and the three global
toolbar axes (theme, all-ten locale, 320/400 width presets for sidepanel
stories). Stories render through the existing per-surface fake-services
modules and typed fixtures — extend those helpers for story use rather
than inventing story-only mocks (journal any gap). Prove the pipeline with
stories for three representative components (one sidepanel with services,
one options form, shared Markdown). Add npm run storybook /
build-storybook; build-storybook joins CI's gate job; stories excluded
from guards like tests; a guard:stories script diffs non-vendored
components against colocated *.stories.svelte files (failing on gaps —
seeded with an allowlist of the not-yet-covered components that cards
124/125 will empty).

## Checklist

- [ ] Storybook runs and builds with verified-current versions; CRXJS never loads; scratch-trial findings journalled
- [ ] Theme/locale/width toolbar globals working incl. real RTL via the bootstrap decorator
- [ ] Three proof stories rendering through the shared fakes
- [ ] guard:stories wired into npm run guard with the temporary allowlist; build-storybook in CI (actionlint clean)
- [ ] npm test, npm run check, npm run guard, npm run build, build-storybook green

---
status: Accepted
date: 2026-08-23
---
# Decision 37 — i18n on Paraglide JS with a completeness guard

## Context

All copy is hardcoded English across ~40 components. Jonathan wants the
correct i18n library for this environment, every string extracted, the top
languages added, and keys type-safe in BOTH directions: a usage cannot name
a key that doesn't exist, and a language cannot ship missing a key. He also
wants a copywriter/humanizer pass over the copy before it ships.

Research (2026-08-23, live docs) compared Paraglide JS, typesafe-i18n,
svelte-i18n, sveltekit-i18n, wuchale, i18next-with-typed-resources, and
native chrome.i18n. Paraglide compiles each message to a typed ESM function
(unknown key = compile error, typed params), tree-shakes per message across
our four MV3 bundles, is CSP-safe (no eval), and is actively maintained.
Its one gap: a locale missing a key silently falls back to the base locale
at compile time, and inlang's own lint tooling for this is
deprecated/removed. Native chrome.i18n has no typing and no runtime
switching but is the only mechanism Chrome accepts for localizing
manifest.json fields.

## Decision

- **Paraglide JS 2.x** for all in-app copy: `messages/{locale}.json` →
  compiled typed message functions in `src/paraglide/`, wired into the
  Vite build and `postinstall`. Components call `m.key()` — direction 1
  is the compiler's job.
- **Direction 2 is our guard's job**: `npm run guard:i18n` diffs every
  locale's key set against the base locale and fails on missing AND orphan
  keys; part of `npm run guard` and the release gate.
- **Locales**: en (source), zh-CN, ja, de, fr, es, pt-BR, ko, ru, ar.
  Arabic makes RTL a first-class requirement: `lang`/`dir` bootstrap per
  surface, and a one-time sweep of physical direction utilities to
  Tailwind logical properties (`ms-`/`me-`/`text-start`/…), with `rtl:`
  flips only for genuinely directional icons.
- **Locale selection**: strategy chain localStorage →
  preferredLanguage → baseLocale, with a language picker in options
  settings; switching uses Paraglide's default full-document reload (a
  rare, deliberate action on these surfaces — no bespoke reactivity
  layer).
- **chrome.i18n `_locales/`** in parallel, for manifest strings only
  (`default_locale`, `__MSG_extName__` etc.), kept to the same locale set.
- **Copy quality gate**: the English source is rewritten by a dedicated
  copywriter/humanizer pass (card 103) BEFORE translation, so each
  language is translated from finished copy exactly once. Translations are
  LLM-produced and flagged for native review post-release.
- Error copy stays out of the domain layer: domain vocabularies carry
  codes; the UI maps codes to messages (aligns with Decision 34).

## Consequences

- Two parallel localization mechanisms (Paraglide + `_locales`) — the
  cost of Chrome's manifest constraint; the guard keeps both locale sets
  aligned.
- Component tests that assert copy assert through the message functions,
  so copy edits don't silently break tests.
- The RTL utility sweep is a real one-time refactor across the component
  set (cards sequence it before translations land).
- Runs after the strict-safety session (cards 91–96) so error-copy
  extraction happens once, at the right layer.

---
status: Accepted
date: 2026-08-24
---
# Decision 39 — CI runs the full gate suite

## Context

The release gate — check, test, six guards, build, verify — exists only as
local npm scripts run by whoever remembers. Every guard was proven by
planted violations, but nothing runs them on push; a bad commit lands
silently until someone's next local run. The verify harness needs Chrome
for Testing with a display (it launches headed for WebMCP support).

## Decision

A GitHub Actions workflow runs on push and pull request:

- **gate job**: npm ci (postinstall compiles i18n), npm run check,
  npm test, npm run guard, npm run build — fast, always on.
- **verify job**: npm run verify under xvfb-run with the Chrome-for-
  Testing cache keyed for reuse; uploads verify/output/screenshots as an
  artifact so visual review needs no local run. If CfT-under-xvfb proves
  flaky, the job is marked non-required with the flake documented — the
  gate job is the hard wall either way.
- Node version pinned from a .nvmrc added alongside; npm cache enabled.

## Consequences

- The guards become protection instead of discipline; the pre-commit
  skill remains the local mirror of the same suite.
- The i18n message-format plugin fetch (jsDelivr on first postinstall)
  happens in CI — cached; if it flakes, the settings.json local-module
  path noted in card 100's journal is the fix.
- Screenshot artifacts give every PR a reviewable visual diff for free.

> Amendment (2026-08-23): the repository origin is the self-hosted GitLab at gitlab.beluga-sirius.ts.net, so the canonical enforcement home is `.gitlab-ci.yml` (gate / verify-allow-failure / package / release stages, with the store zip uploaded to the Generic Package Registry and attached to the GitLab Release on v* tags). The GitHub workflow is retained unchanged for a potential GitHub mirror.

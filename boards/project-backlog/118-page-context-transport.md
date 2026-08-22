---
column: todo
labels: [backend, infra]
priority: high
updatedAt: 2026-08-24T12:30:00.000Z
---
# Page context: relay extraction and transport

First card of decisions/40-page-context-access.md: the relay learns to
answer two pull requests — current selection (document.getSelection,
trimmed, with a has-more flag if collapsed/empty distinctions matter) and
a page-text extract (dependency-free DOM walk: visible text with heading
structure and link text, scripts/styles/nav noise skipped, hard
size-capped with a truncated flag; measure a few real pages to pick the
cap and journal it). Two new protocol messages via the single-sourced
message list (infra/chrome-runtime/protocol.ts) routed like get-tools
(panel → worker → relay, timeouts on the existing ladder). Domain:
PageContext model in the chat context (selection/extract + url/title +
truncation), a driven port for pulling it, the worker/relay plumbing as
the adapter. No UI in this card — prove it end to end with unit tests
(extraction against jsdom fixtures incl. a noisy page) and a verify-level
probe (control-page message round-trip against the demo page, following
the existing runtime.mjs pattern).

## Checklist

- [ ] Relay extraction implemented, dependency-free, capped; jsdom unit tests incl. noisy/huge/empty pages and selection edge cases (collapsed, cross-frame unavailable)
- [ ] Protocol messages added via the single source; guard boundaries green; timeout rungs chosen and documented
- [ ] Domain PageContext + pull port; worker routing tested at the sw.test seam
- [ ] Verify probe: selection + extract round-trip against the demo page
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

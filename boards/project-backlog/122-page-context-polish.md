---
column: backlog
labels: [frontend, backend]
priority: low
updatedAt: 2026-08-25T04:10:00.000Z
---
# Page-context polish (backlog)

Residuals from card 120's closing judgment, filed so they stop being
folklore: (1) a persistent per-site "never share this site" setting — the
in-memory per-tab/per-origin gate deliberately isn't a setting, but someone
will ask; would need options UI + storage + decision-40 amendment. (2) The
PageContext (ports.ts, the page a turn runs against) vs PageContextSnapshot
naming debt. (3) Consider surfacing the 16KB extract cap in docs/07 for
local-model users, since the truncation marker is load-bearing on 8k
contexts.

## Checklist

- [ ] Judged and implemented or explicitly declined per item, decision-40 amended if (1) lands

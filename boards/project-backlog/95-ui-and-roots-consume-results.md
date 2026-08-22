---
column: todo
labels: [frontend, backend]
priority: med
updatedAt: 2026-08-23T10:00:00.000Z
---
# UI, services and composition roots consume results; throw audit to zero

Finish the errors-as-values migration at the driving edge per
decisions/34-errors-as-values.md: the chat domain service and turn engine's
own driving API, the sidepanel stores/services, both surfaces' components,
tab-sync and page-tool-executor adapters, and the four composition roots.
Every user-visible failure path (notices, test banners, approval timeouts,
storage-degraded warnings) is driven by a typed error value, never a caught
exception. Then run the strict throw audit: every surviving `throw` under
src/ is on the guard:throws allowlist with a named invariant, and the
allowlist contains ONLY programmer-error assertions (exhaustiveness,
impossible states). Boundary catch-alls (top-level error logging in roots,
the never-throws wrappers) are the only try/catch left.

## Checklist

- [ ] Chat service/turn driving APIs return typed results; UI stores consume tuples; no try/catch in components or stores except documented boundary logging
- [ ] tab-sync, page-tool-executor and remaining chrome-runtime adapters map platform errors to values at the boundary
- [ ] guard:throws allowlist reviewed line by line: only invariant assertions remain, each naming its invariant; count journalled before/after
- [ ] Error-path UX verified unchanged (notices, banners, retry affordances) via component tests and the verify run
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

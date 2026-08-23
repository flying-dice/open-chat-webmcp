---
column: backlog
labels: [infra]
priority: low
updatedAt: 2026-08-23T16:40:00.000Z
---
# Evaluate the bun toolchain switch (backlog)

The Aug-20 remote commit switched the lockfile to bun; the merge kept npm
(Jonathan's call, 2026-08-23) because the bun.lock predated ~40 newer
dependencies and the whole validated pipeline is npm-based. If bun is still
wanted: regenerate bun.lock from the current package.json, convert both CI
pipelines and docs (install/run/cache keys/.nvmrc story), verify the
Paraglide postinstall codegen and a fresh-clone gate run under bun, and
re-prove the packaging job. One card, all-or-nothing — no dual-lockfile
state.

## Checklist

- [ ] Judged with Jonathan; implemented fully or explicitly declined

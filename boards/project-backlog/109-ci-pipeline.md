---
column: todo
labels: [infra]
priority: high
updatedAt: 2026-08-24T11:00:00.000Z
---
# CI pipeline running the full gate suite

Implement decisions/39-ci-pipeline.md: a GitHub Actions workflow with a
fast always-on gate job (npm ci → check → test → guard → build) and a
verify job running the Chrome-for-Testing harness under xvfb with the CfT
cache keyed for reuse and screenshots uploaded as artifacts. Pin Node via
.nvmrc; enable npm caching. CI can't be fully exercised locally — validate
the workflow YAML (actionlint if available, or careful schema review),
dry-run every command locally exactly as the workflow spells it (fresh
npm ci in a temp clone to prove postinstall/i18n codegen works from
scratch), and journal what could only be proven on a real runner.

## Checklist

- [ ] .github/workflows/ci.yml: gate job + verify job per decision 39; concurrency-cancel on superseded pushes
- [ ] .nvmrc added and referenced; caches for npm and .chrome-for-testing keyed sensibly
- [ ] Fresh-clone dry run proves npm ci → gate sequence green from scratch (journal the run)
- [ ] Screenshot artifact upload wired; verify job's flake posture documented per decision 39
- [ ] docs updated (README badge optional; docs mention CI as the enforcement home)
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green locally

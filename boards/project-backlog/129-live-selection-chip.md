---
column: doing
agent: claude-opus
live: true
status: Making the selection chip track the page live
progress: 5
labels: [frontend, backend]
priority: high
updatedAt: 2026-08-24T00:40:00.000Z
---
# Live selection chip (Gemini-style)

Per decisions/40 as revised today: the chip updates as the user selects
different text, without interacting with the panel. Relay: debounced
document selectionchange listener emitting a content-free
runtime:selection-changed ping (single-sourced message list; notify only
when the settled state actually differs — no per-character spam; covers
form-control selections, which fire document selectionchange in Chrome).
Worker: route like tools-updated with the sender tab id. Panel: the infra
chrome-runtime layer exposes a subscription port (stores may not touch
chrome.*); pageSharing reacts to a ping for the CURRENT tab by running the
existing gated refreshSelection — every guard (no pageInfo, restricted,
dismissed, superseded pulls, dismissed-text) applies unchanged. Update
docs/03 + PRIVACY.md wording per the decision; extend the sharing-gate
scenario with a no-panel-interaction step (select → chip appears; change
selection → chip text changes; dismiss gate → pings ignored). Keep the
diagnostic breadcrumbs coherent with the new trigger.

## Checklist

- [ ] Ping is content-free and debounced; relay tests incl. no-spam and form-control coverage
- [ ] Worker routing tested at the fake-chrome seam; protocol single source updated
- [ ] Panel subscription port + gated reaction; dismissed gate proven to ignore pings
- [ ] docs/03 + PRIVACY.md updated; decision 40 revision referenced
- [ ] Sharing-gate scenario extended with the live-update steps, 3x green
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

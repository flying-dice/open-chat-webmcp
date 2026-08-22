---
column: todo
labels: [infra, frontend]
priority: med
updatedAt: 2026-08-24T11:00:00.000Z
---
# Verify scenario pack: real-UI flows in the harness

The required verify checks drive chrome.* directly (by design) and the
smoke scripts cover one happy path each. Add a UI-driven scenario pack —
the flows a human would regression-test by hand — following the smoke
scripts' established structure (best-effort tier unless a scenario proves
rock-solid):

- Approval flow: a page tool without auto-run → approval card renders →
  approve runs it, deny records the denial in the call log; skip-for-
  session honoured on the second call.
- Stop mid-turn: send, stop while streaming, transcript left consistent,
  composer re-enabled.
- Tab switch mid-turn: the turn keeps writing to its chat (card 77's
  guarantee) — switch demo tabs, assert no bleed.
- History via UI: open a previous chat, delete another, empty state.
- Inspector: server tools listed with origin badges after MCP discovery
  (fixture MCP server or skip-with-reason if none reachable).
- Wire the tiers: npm run verify (required), verify:smoke (options +
  live + scenarios), documented in docs/07 if card 110 landed it.

## Checklist

- [ ] Scenario pack landed following the harness patterns, each scenario asserting state not just pixels
- [ ] Flake posture per scenario recorded (required vs best-effort) with reasons
- [ ] Tier wiring + docs updated
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green; scenario pack green on three consecutive runs

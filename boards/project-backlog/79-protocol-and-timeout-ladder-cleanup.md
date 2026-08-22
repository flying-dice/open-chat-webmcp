---
column: todo
labels: [backend, bug]
priority: med
updatedAt: 2026-08-22T13:30:00.000Z
---
# Protocol and timeout-ladder cleanup

Two hand-maintained parallel copies in the messaging layer get a single source of
truth, following the "shared code lives in domain or infra" rule in
`.claude/skills/ddd-hexagonal/SKILL.md` and the layout of
decisions/29-ddd-hexagonal-typescript-layout.md. `isRuntimeMessage`
(src/lib/protocol.ts:196-205) is a hand-written list of message-type strings kept
in step with the union by hand — pure drift hazard. The timeout ladder is worse:
the relay's `EXECUTE_TIMEOUT_MS` 20s (relay.ts:65), the worker's `CALL_TIMEOUT_MS`
30s and `PULL_TIMEOUT_MS` 3s, a fourth copy mirrored by hand as
`RELAY_EXECUTE_TIMEOUT_MS` in verify/run.mjs:55, and `TOOL_CALL_TIMEOUT_MS` in
`src/sidepanel/services/agentLoop.ts` which sits outside the ladder and is
shorter than the rungs beneath it — the open defect flagged in the comment at
sw.ts:234-239.

## Checklist

- [ ] `isRuntimeMessage` is derived from the message-type union (a `Record<RuntimeMessage["type"], true>` or equivalent) so adding a message type without updating the guard is a compile error, not a silent gap
- [ ] one shared constants module owns the whole ladder — page-tool execute (relay 20s), worker call (30s), worker pull (3s) and the agent-loop tool-call budget — with the ordering invariant written down next to the values
- [ ] `TOOL_CALL_TIMEOUT_MS` in `agentLoop.ts` joins the ladder and is no longer shorter than the rungs below it; the defect comment at `src/background/sw.ts:234-239` is resolved and rewritten to describe the fixed ordering
- [ ] `src/content/relay.ts:65` and `src/background/sw.ts` import their values from the shared module instead of declaring their own
- [ ] `verify/run.mjs:55` imports the same values rather than mirroring them by hand (from `src/` or a plain-JS constants file both the bundle and the harness can load) — no third copy anywhere
- [ ] the shared module sits where all three surfaces plus the harness may import it without creating a cross-surface edge; `npm run guard:boundaries` green on the placement
- [ ] verify's "hangs-forever trips the relay EXECUTE_TIMEOUT" scenario still passes with the derived values, and a tool call slower than the agent-loop budget now fails at the agent-loop rung with the ladder intact
- [ ] npm run check, npm run build, npm run guard and npm run verify green

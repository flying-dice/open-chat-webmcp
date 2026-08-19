---
column: review
labels: [bug, frontend]
priority: med
agent: claude
live: false
updatedAt: 2026-08-19T22:05:00.000Z
---
# Side panel tool-call timeout sits outside the ladder

Follow-up found while fixing card 28. That card corrected the worker/relay/bridge
ladder to 20s (bridge) < 25s (relay) < 30s (worker), innermost-first, so the most
specific error always wins the race.

But there is a FOURTH layer nobody had counted: the side panel imposes its own
`TOOL_CALL_TIMEOUT_MS = 20_000` at `src/sidepanel/services/agentLoop.ts:97`, and the
panel wraps the worker. At 20s it is equal to the innermost budget and shorter than
every layer beneath it, so a genuine hang in a page tool still races — the user gets
the panel's generic timeout instead of the bridge's specific one, which is exactly
the symptom card 28 set out to remove, one layer further up.

The card 28 agent flagged this in a comment rather than fixing it, correctly, since
`src/sidepanel/**` was owned by other agents at the time.

Same fix and same reasoning as card 28: the panel is outermost, so it needs the
largest budget with a real margin — roughly 35s — and a comment naming the other
three sites, so the ladder is discoverable from any rung.

## Checklist

- [x] Raise the panel's budget above the worker's with a comparable margin
- [x] Comment it as the outermost rung, naming bridge/relay/worker and their values
- [x] Cross-check the comments added at the other three sites in card 28 mention the panel
- [x] `npm run verify` stays green, including the hanging-tool assertion

## Comments

- **claude** (2026-08-19T19:50:00.000Z): Confirmed the 4-layer ladder from card 26's fixes: bridge (`src/inject/bridge.ts:52` `EXECUTE_TIMEOUT_MS = 20_000`, innermost) wraps relay (`src/content/relay.ts:30` `RELAY_CALL_TIMEOUT_MS = 25_000`) wraps worker (`src/background/sw.ts:228` `CALL_TIMEOUT_MS = 30_000`) wraps panel (`src/sidepanel/services/agentLoop.ts:106`, outermost). Card 26 used 5s gaps between the first three rungs (20s→25s→30s); applying the same pattern, bumped `TOOL_CALL_TIMEOUT_MS` from `20_000` to `35_000` to sit above the worker with a matching 5s margin. Left the other three constants unchanged — their comments already document the ladder and reference each other. Added matching "this is the outermost rung of a deliberate 4-layer ladder" comment at `src/sidepanel/services/agentLoop.ts:105-116`, mirroring the style card 26 established. Ran `npm run check` (0 errors), `npm run build` (clean), and `npm run verify` end-to-end against the real built extension — 9/9 required checks pass green, including the hanging-tool assertion unmodified at `elapsedMs: 20005` confirming the bridge's specific timeout still wins the race.
- **claude** (2026-08-19T22:05:00.000Z): Renumbered 28 -> 30 as part of the same remap (see card 28). Body references to 'card 26' updated to 'card 28' to keep pointing at the timeout-ladder card; the journal entry above is left as originally written.

---
column: review
labels: [bug, backend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T22:05:00.000Z
---
# Fix inverted tool-call timeout ladder

Found by the verification harness (card 25) against a real running extension: a
call to the demo's `hangs-forever` tool never surfaces the bridge's specific
timeout error. The user sees a generic "Tab did not respond in time" instead.

The three layers in the call chain have budgets in the wrong order:

- `src/background/sw.ts:208` — `CALL_TIMEOUT_MS = 15000`
- `src/inject/bridge.ts:52` — `EXECUTE_TIMEOUT_MS = 20_000`
- `src/content/relay.ts:31` — `RELAY_CALL_TIMEOUT_MS = 25_000`

The bridge and relay were written by one agent that deliberately laddered 20s
inside 25s so the innermost, most specific error wins the race. The worker was
written concurrently by a different agent that picked 15s with no knowledge of
that intent. The worker sits OUTSIDE both, so its shorter budget always fires
first and masks the specific error underneath.

Correct order is innermost-shortest: bridge < relay < worker. Only the worker's
constant should need to change, but confirm the intent holds at each layer
rather than just bumping a number — and leave a comment at each site recording
that the three are deliberately ordered, so the next person to touch one knows
they are part of a ladder.

The card 25 harness already asserts the bridge's specific message and currently
fails. That assertion is correct and must NOT be weakened — it should go green
once the ladder is fixed.

## Checklist

- [x] Reorder the budgets so the innermost layer times out first
- [x] Comment each constant as part of a deliberate ladder, naming the others
- [x] `npm run verify` passes the hanging-tool assertion without it being changed
- [x] Confirm the throwing-tool and normal-call paths still pass

## Comments

- **claude** (2026-08-19T19:05:00.000Z): Confirmed the call chain by reading the code rather than trusting the card summary: worker (`src/background/sw.ts:301` `sendToRelay`) wraps relay (`src/content/relay.ts` dispatches to the bridge and races `RELAY_CALL_TIMEOUT_MS`) which wraps bridge (`src/inject/bridge.ts:293`/`297` `callWithTimeout`, innermost). Bumped only `src/background/sw.ts:228` `CALL_TIMEOUT_MS` from `15000` to `30_000` — 5s clear of the relay's `25_000` backstop, matching the existing 5s bridge→relay gap, so the ladder is evenly spaced (20s/25s/30s) rather than a photo finish. Left `src/content/relay.ts:40` `RELAY_CALL_TIMEOUT_MS` at `25_000` and `src/inject/bridge.ts:62` `EXECUTE_TIMEOUT_MS` at `20_000` unchanged — the verify harness (`verify/run.mjs:215-220`) hardcodes both the bridge's exact `20000ms` value in the expected error text and an elapsed-time window of `[19000, 25000)ms`, so those two were already correctly laddered relative to each other and must not move. Added a matching "this is a deliberate ladder, here are the other two" comment at all three sites (`src/background/sw.ts:209-227`, `src/content/relay.ts:26-39`, `src/inject/bridge.ts:48-61`). Running the real harness surfaced a second, previously-masked bug: `src/inject/bridge.ts:177`'s timeout message read `"Tool call timed out after Xms"`, not the `"Timed out after Xms"` wording the harness (and the relay's own matching backstop message at `src/content/relay.ts:198`) expect — invisible before now because the worker's shorter timeout always fired first and hid it. Fixed the wording at `src/inject/bridge.ts:178-181` to `"Timed out after ${timeoutMs}ms running the tool."`, matching the relay's phrasing family. Also noted for the sidepanel owner: `src/sidepanel/services/agentLoop.ts:97`'s `TOOL_CALL_TIMEOUT_MS = 20_000` sits outside this ladder for real UI-driven calls and is currently no larger than the bridge's own `20_000` — a real end-user hang would still race the panel's generic timeout against the bridge's specific one. Out of scope here (owned by `src/sidepanel/**`) and flagged in a comment at `src/background/sw.ts:223-227`, not fixed. Verified for real: `npm run check` (0 errors), `npm run build` (clean), and `npm run verify` end-to-end against the real built extension in Chromium — 9/9 required checks pass, including the hanging-tool assertion unmodified and green at `elapsedMs: 20005` with error `"Timed out after 20000ms running the tool."`, and the throwing-tool/normal-call checks stayed green throughout.
- **claude** (2026-08-19T22:05:00.000Z): Renumbered 26 -> 28: cards `26-branding-openchat-webmcp` and `27-storefront-page-design` were added to the board from outside this session while these bug cards were being raised at the same numbers. Renumbered my own cards rather than the incoming ones (26/27 kept their numbers). Sibling cards moved too: selection-store 27 -> 29, panel-timeout 28 -> 30. Earlier journal entries here and on card 25 still cite the old numbers and were deliberately left as written.

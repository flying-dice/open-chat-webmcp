// The TURN-PHASE state machine (decisions/26-transcript-activity-groups-and-turn-phase.md,
// card 60), moved out of src/sidepanel/stores/panel.svelte.ts by card 77.
//
// It described a turn, not a view: the phases are the states ./turn.ts's loop
// actually passes through, and the loop is what writes them. Leaving the type
// in a Svelte store meant the loop imported its own state machine back out of
// the thing displaying it.
//
// THE ANTI-FLICKER INVARIANT (decisions/26) lives with the loop rather than
// here, because it is a rule about SEQUENCE, not about shape: every phase the
// loop sets is a REPLACEMENT of the previous one, and the ONLY clear to
// `null` is the outer `finally` of a turn — so the indicator can never blink
// off in the gap between one round's assistant message closing and the next
// tool call or provider request starting. See `runTurn` in ./turn.ts.
//
// Deliberately NOT persisted (same class as the streaming buffer): a stored
// "calling…" would be a lie the moment the panel reopens (decisions/26 §2).
// The honest consequence is that a tool row still `pending` after a reopen
// renders as "no result recorded" rather than as a spinner that will never
// resolve — because there is no live phase left to say otherwise.

import type { ToolOrigin } from "../tools";

/**
 * The four phases a turn can be in, written by ./turn.ts as the loop
 * progresses through one round:
 *   - `waiting`: a request is open with the model gateway but no token has
 *     arrived yet (also covers the tool-list lookup a tool-capable turn makes
 *     before its first `chat()` call).
 *   - `streaming`: tokens are landing in the current assistant message.
 *   - `awaiting-approval`: the loop is blocked on a human decision for
 *     `toolName` (card 09) — `origin` says where it would run.
 *   - `calling`: `toolName` is actually executing (page or MCP server,
 *     `origin` says which) — `startedAt` is the CALL's own start time, not the
 *     turn's, and is reset after an approval wait so an elapsed-time indicator
 *     (card 61) measures the call itself rather than including the time a
 *     human spent deciding.
 */
export type TurnPhase =
  | { kind: "waiting" }
  | { kind: "streaming" }
  | { kind: "awaiting-approval"; toolName: string; origin?: ToolOrigin }
  | { kind: "calling"; toolName: string; origin?: ToolOrigin; startedAt: number };

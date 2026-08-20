---
column: review
labels: [frontend]
priority: high
agent: claude
live: false
progress: 100
updatedAt: 2026-08-20T12:45:00.000Z
---
# An explicit turn-phase signal (and the Stop button it fixes)

`panel.isStreaming` only means "tokens are landing in message X". `runLoop`
closes the assistant message *before* it executes tool calls, so that flag is
false for the whole tool round — there is currently no signal at all for "a turn
is in flight but no tokens are arriving", and the composer's Stop button
disappears exactly when a call is hanging.

This card adds the signal and rewires the three places that wanted it. No new UI
— card 61 renders it. See decisions/26-transcript-activity-groups-and-turn-phase.md.

## Checklist

- [x] `src/sidepanel/lib/duration.ts`: `formatDuration(ms)`, lifted from the rule
      inlined in `CallLogEntry.svelte:48-52`; refactor that file to import it
- [x] `panel.svelte.ts`: `TurnPhase` union (`waiting` | `streaming` |
      `awaiting-approval` | `calling`), `turnPhaseByChat` `$state` record keyed by
      chat id beside `streamingByChat`, `setTurnPhase(phase, target = session)`
- [x] `panel.turnPhase` + `panel.isTurnActive` getters — VISIBLE chat only, same
      shape as `streamingMessageId:427-430`
- [x] `turnPhaseByChat` added to `webmcpPanelDebugSnapshot()`
- [x] `agentLoop.ts` transitions: `waiting` after `registerLiveSession` and after
      each `beginAssistantMessage`; `streaming` on the first non-empty content
      delta; `calling` before the first `await` in `executeToolCall`;
      `awaiting-approval` before `waitUntilVisible`; `calling` re-set with a fresh
      `startedAt` after an approval
- [x] The ONLY `null` write is `runAgentTurn`'s outer `finally` — no per-return
      clears (they drift; the `finally` is the one point all exits unwind through)
- [x] `App.svelte`: `handleNewChat` guard, `newChatDisabled`, and the composer's
      streaming prop all move to `panel.isTurnActive`; `Composer` prop renamed
      `streaming` → `busy` with an updated doc comment
- [x] `panel.isStreaming` left narrow — still what suppresses `MessageActions`
- [x] `npm run check` green (172 files, 0 errors); `npm run build` green.
      Stop-present-during-`hangs-forever` is a real-browser check — left to the
      overseeing session's manual verification per this card's scope note (no
      `npm run verify`/`npm run launch` run here)

## Gates

- [x] check-green — `npm run check`: 172 files, 0 errors, 0 warnings (claude-sonnet, 2026-08-20T12:45:00.000Z)

## Comments

- **claude-sonnet** (2026-08-20T12:45:00.000Z): Implemented decisions/26 §2's `TurnPhase` signal end to end.
  - Lifted `formatDuration` into `src/sidepanel/lib/duration.ts:1-12` and pointed `src/sidepanel/components/CallLogEntry.svelte:24,49-52` at it — no second inlined copy.
  - `src/sidepanel/stores/panel.svelte.ts:388-437` adds the `TurnPhase` union (404-407), `turnPhaseByChat` (`$state`, 424, beside `streamingByChat`), and `setTurnPhase(phase, target = session)` (435-438). Two new getters at `src/sidepanel/stores/panel.svelte.ts:486-501`: `panel.turnPhase` (487-489) and `panel.isTurnActive` (500-502), both reading the visible chat only via `session.id`, same shape as `streamingMessageId`. `turnPhaseByChat` added to the debug snapshot type (`panel.svelte.ts:852`) and value (`panel.svelte.ts:868`).
  - `src/sidepanel/services/agentLoop.ts`: imported `setTurnPhase` (line 113); `{kind:"waiting"}` right after `registerLiveSession(target)` (agentLoop.ts:313-319); the outer `finally` (agentLoop.ts:351-357) is now the **only** place that writes `null` (agentLoop.ts:355), with a comment enumerating every exit path that unwinds through it and warning against per-return clears; `runLoop`'s per-iteration `{kind:"waiting"}` right after `beginAssistantMessage` (agentLoop.ts:452,456), plus a comment at agentLoop.ts:469-472 explaining the phase is deliberately left alone after `endAssistantMessage` (anti-flicker); `streamOneTurn` gained a local `sawContent` flag (agentLoop.ts:515) and flips to `{kind:"streaming"}` on the first non-empty content delta (agentLoop.ts:521-524); `executeToolCall` sets `{kind:"calling", startedAt}` immediately after the tool lookup (agentLoop.ts:597) and before the first `await` (agentLoop.ts:606), overrides to `{kind:"awaiting-approval"}` before `waitUntilVisible` (agentLoop.ts:627), and re-sets `calling` with a fresh `startedAt` right after `mode = "approved"` (agentLoop.ts:642,646). A denied call returns without any phase write, as specified.
  - `src/sidepanel/App.svelte`: `handleNewChat`'s guard (App.svelte:201-203), `newChatDisabled` (App.svelte:289), and the `<Composer>` call site (App.svelte:342-344) all moved from `panel.isStreaming` to `panel.isTurnActive`. `panel.isStreaming` itself is untouched and still feeds `Transcript`'s `streamingMessageId`-based `MessageActions` gating (unaffected by this card).
  - `src/sidepanel/components/Composer.svelte`: prop renamed `streaming` → `busy` throughout (interface at Composer.svelte:56-65, destructure at Composer.svelte:68, `blocked` derivation at Composer.svelte:82-85, `send()` guard at Composer.svelte:102, textarea `disabled` at Composer.svelte:163, Stop-button branch at Composer.svelte:189), doc comment rewritten (Composer.svelte:1-18) to explain the semantics and why the old `streaming` prop hid Stop for the whole tool round.
  - `npm run check`: 172 files, 0 errors (baseline was 170; the extra files are pre-existing uncommitted work from other in-flight cards in this shared tree, not mine). `npm run build` succeeds. Did not run `npm run verify`/`npm run launch` per this card's scope note — the real-browser "Stop stays visible during a `hangs-forever` tool call" check is left for the overseeing session.
  - Scope check: touched only the files listed above plus this card. Did not create `ActivityGroup`/`ToolCallRow`/`ActivityIndicator`, did not touch `Transcript.svelte`, did not delete `ToolCallCard.svelte`, did not touch `verify/` — all card 61 territory.
  - Nothing found that deviated from the spec or that belongs to card 61 beyond what decisions/26 already calls out.

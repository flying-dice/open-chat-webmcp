---
column: review
agent: claude-sonnet
live: false
labels: [bug, backend]
priority: high
updatedAt: 2026-08-22T09:05:00.000Z
---
# Fix the three pinned domain bugs

The test phase pinned three real defects with failing/regression tests;
fix them so the pins go green. Per .claude/skills/ddd-hexagonal/SKILL.md all
three live in the domain layer, so fixes are pure and unit-testable.

1. **Duplicate tool-call ids clobber results** (src/domain/chat/message.ts:147,
   src/domain/chat/service.ts:232; pinned `it.fails` in turn.test.ts): a model
   emitting two tool calls with the same id makes the second result overwrite
   the first and strands the second entry as `pending` forever. Key results by
   position or a disambiguated id.
2. **Concurrent second turn clobbers live/stop registration**
   (src/domain/chat/service.ts:450-481; pinned `it.fails` in service.test.ts):
   a second turn starting while one is in flight lets the first turn's
   `finally` clear the second's registration. Either reject the second turn
   cleanly or make registration turn-scoped.
3. **disambiguateName fails at the truncation ceiling**
   (src/domain/tools/merge.ts:145-154; pinned regression test in
   merge.test.ts): two server tools whose namespaced names both truncate to
   the 64-char ceiling collide; the disambiguation suffix is truncated away,
   leaving the second tool unreachable. Reserve suffix room when truncating.

Also resolve the two `it.todo` undecided behaviours from card 85: decide the
intended behaviour (smallest honest semantics), implement or document, and
turn each todo into a real test.

## Checklist

- [x] All three pinned tests flipped from it.fails/regression-pin to green assertions of correct behaviour
- [x] The it.todo in scope (turn.test.ts) decided, implemented, and asserted — the OTHER it.todo (src/infra/ollama/client.test.ts:460) is outside my assigned files, left for coordination (see journal)
- [x] No behaviour change beyond the fixes; full suite green (736 tests, 1 todo remaining — the out-of-scope one)
- [x] npm test (`npx vitest run` — 48 files, 735 passed + 1 todo), npm run check (0 errors), npm run guard (nothing above 0.5) and npm run build all green. npm run verify intentionally NOT run per instructions (coordinator runs post-batch).

## Gates

- [x] tests-passing — `npx vitest run` green: 48 files, 735 passed + 1 todo (735/736) (claude-sonnet, 2026-08-22T09:05:00.000Z)
- [x] check-clean — `npm run check` 0 errors, 0 warnings across 1075 files (claude-sonnet, 2026-08-22T09:05:00.000Z)
- [x] guard-clean — `npm run guard` clean, nothing above the 0.5 debt threshold (claude-sonnet, 2026-08-22T09:05:00.000Z)
- [x] build-green — `npm run build` (vite build) succeeded (claude-sonnet, 2026-08-22T09:05:00.000Z)

## Comments

- **claude-sonnet** (2026-08-22T08:35:00.000Z): Claimed the card. Read the three bugs and the pinned tests: `src/domain/chat/turn.test.ts:997` (duplicate tool-call ids), `src/domain/chat/service.test.ts:574` (concurrent-turn registration clobber), `src/domain/tools/merge.test.ts:309` (disambiguation at the 64-char ceiling). Also found the two `it.todo`s: one in scope at `src/domain/chat/turn.test.ts:1136`, one OUT of scope at `src/infra/ollama/client.test.ts:460` — leaving the latter alone and journaling it per the coordination instruction rather than editing a file outside my assigned set.
- **claude-sonnet** (2026-08-22T08:45:00.000Z): Bug 3 fixed in `src/domain/tools/merge.ts:145-171`. Root cause: `disambiguateName` built each `-N` candidate by appending the suffix to the (possibly already-64-char) name and THEN truncating the result back to `MAX_TOOL_NAME_LENGTH`, which throws away exactly the appended suffix digits once `name` is already at the ceiling — reproducing the original colliding name verbatim. Fix: new `suffixedCandidate` helper (merge.ts:126-141) reserves room for the suffix by trimming the BASE name first, so the suffix always survives. Flipped the "known bug" regression pin in `merge.test.ts:309-325` from documenting the collision to asserting the two tools now get distinct, still-in-budget names.
- **claude-sonnet** (2026-08-22T08:55:00.000Z): Bug 1 fixed. Root cause: `toolEntry` (`message.ts:148`) keyed a transcript entry's `id` by `call.id` itself, and `ChatService.addToolCall` (`service.ts:384`) returned that same `call.id` and used it again to key the tool-call log entry (`session.ts` `logToolCall`/`completeToolCall`) — so two tool calls sharing one `call.id` in the same round (a hallucinating/buggy model) collided in both the transcript's `findEntry` lookup and the call log's, and `Array.prototype.find` always resolved a later `updateToolCallResult` against the FIRST entry, clobbering it and leaving the second stuck `"pending"`. Fix: `toolEntry` now takes an explicit `id` parameter distinct from `call.id` (`message.ts:117-163`); `ChatService.addToolCall` mints a fresh id via the existing `makeMessageId()` and uses it for BOTH the transcript entry and the call-log entry (`service.ts:384-406`), so `ToolCallRow.svelte:110`'s `entry.id === message.id` cross-reference between the two views still lines up, while `toolCallId` keeps carrying the model's own (possibly duplicated) `call.id` for `toModelMessage`. Updated `turn.test.ts`'s `makeTranscript` fake and all `toolEntry(...)` call sites in `message.test.ts`/`turn.test.ts` for the new signature, flipped the `it.fails` pin at `turn.test.ts:997` to a plain green test, and updated `service.test.ts:335-361`'s assertion (which had hard-coded the old id-equals-call.id assumption) to assert the new, intentional distinction instead.
- **claude-sonnet** (2026-08-22T09:00:00.000Z): Bug 2 fixed in `service.ts:209-220,450-493`. Root cause: `runTurn`'s `finally` block unconditionally deleted `liveSessions`/`stopHandlers` for its chat id with no way to distinguish "the registration I set up" from "whatever is registered now" — so a second turn starting for the same chat while the first was still in flight got its registration wiped out the moment the FIRST turn's `finally` ran, even though the second was still genuinely streaming. Fix: added a per-chat `activeTurnCounts` refcount; `runTurn` increments it on entry and only tears down the shared registration (and clears the presenter phase/streaming indicators, per decisions/26) when its `finally` brings the count back to zero — a still-running sibling turn keeps `isTurnActive` reporting true. `requestStop` now always targets whichever controller was registered LAST (the smallest honest choice, since nothing upstream prevents two turns racing for one chat). Flipped the `it.fails` pin at `service.test.ts:574` to a plain green test.
- **claude-sonnet** (2026-08-22T09:02:00.000Z): Decided the in-scope `it.todo` at `turn.test.ts:1136` (now removed): "should tool calls carried on a `tool-calls` event still run when the same round's stream then dies with a terminal error before `done`?" Decision: NO — discarding them (the existing behaviour) is the intended, smallest-honest semantics, journaled at `turn.test.ts:1096-1108`. Reasoning: a round that never reached `done` gives no guarantee the `tool-calls` seen so far are the model's complete/final list, so running possibly side-effecting tools off an unconfirmed, possibly-partial list is a real risk that silently dropping them is not — and the terminal-error note already offers an explicit `"retry"` action (`turn.ts:258-263`/`actionsForStreamError`) that starts a completely fresh, fully-committed round instead. Added a new asserting test, `turn.test.ts:1132-1161`, that the discarded-tool-calls note carries exactly `[{kind: "retry"}]`, replacing the removed `it.todo`. The OTHER `it.todo` (`src/infra/ollama/client.test.ts:460`, about whether a truncated/no-`done:true` NDJSON stream should synthesize a terminal error) is outside my assigned files (`src/domain/chat/*`, `src/domain/tools/merge.ts`) — left untouched; needs pickup by whichever agent/card owns `src/infra/ollama`.
- **claude-sonnet** (2026-08-22T09:04:00.000Z): Full gate run: `npx vitest run src/domain` — 345 passed. Full `npx vitest run` — 48 files, 735 passed + 1 todo (the out-of-scope one above). `npm run check` — 0 errors/warnings across 1075 files. `npm run guard` — clean, nothing above the 0.5 debt threshold. `npm run build` — succeeded. Did not run `npm run verify` per instructions (coordinator runs it post-batch). Moving to `review`.

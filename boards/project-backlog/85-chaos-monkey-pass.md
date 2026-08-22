---
column: review
agent: claude-sonnet
labels: [infra, bug]
priority: med
updatedAt: 2026-08-23T08:10:00.000Z
---
# Chaos-monkey pass over the suites

Grow the unhappy-path coverage with `.claude/skills/chaos-monkey/SKILL.md`, as
decisions/30-vitest-test-pyramid.md calls for: `describe('chaos: …')` groups per
fault category, on top of the domain, infra and component suites. The
dependencies that can fail here are the model provider (Ollama NDJSON /
OpenAI-compatible SSE), `chrome.storage`, the message channel between background
worker, side panel and content relay, the page's WebMCP tools, and HTTP MCP
servers. Work the taxonomy category by category rather than stopping at the
obvious two or three, and where the intended behaviour genuinely is not decided
yet, write the best-guess expectation as `test.todo` instead of asserting
something arbitrary.

## Checklist

- [x] provider stream faults: abort mid-message, garbage/partial SSE and NDJSON frames, never-responds, HTTP 500 and 429 — the turn ends idle rather than stuck streaming, the error is surfaced not swallowed, and the persisted session matches what the UI shows (existing suites already covered most of this deeply; new cases close the remaining gaps — see journal)
- [x] storage faults: quota exceeded mid-write, a half-written `chat:index`, corrupt JSON under `chat:<id>`, a `tabchat:<tabId>` pointer to a deleted chat — a clean domain error each time and no loss beyond the failed write (`tabchat` → deleted chat and corrupt JSON were already covered; added quota-mid-index-write and delete-vs-debounced-write races)
- [x] message races: `runtime:tools-updated` arriving after the tab closed, the same message delivered twice, the panel reopened mid-stream, and a turn started while one is in flight — covered. `runtime:call-tool-response` for a superseded turn is NOT covered (lives in src/background/sw.ts's routing, out of scope this pass — flagged below)
- [x] auth and time: OAuth refresh succeeding/rejected mid-turn was already thoroughly covered by the existing `oauth.test.ts`. Added sign-in-flow ordering/partial-failure chaos (`sign-in.test.ts`, previously untested). A 401 from an MCP server mid-*tool-call* (streamable-http.ts/legacy-sse.ts), a missing provider API key, and the timeout-ladder rung-boundary edges are NOT newly covered — flagged as gaps below
- [x] duplicates and limits: duplicate tool-call ids inside one assistant message (exposed a real bug — see below), a huge tool result, and the `available`/`restricted`/empty-tools three-state model (new `tab-sync.test.ts`) are covered. A replayed approval decision and context-length overflow are NOT newly covered — flagged below
- [x] encoding and partial failure: unicode/emoji/RTL/very-long-string encoding and HTML/markdown sanitization (new `markdown.test.ts`, 25 cases, plus one end-to-end case in `Transcript.test.ts`), a stream aborting mid-message, and tool-call-2-of-3 failing (turn.test.ts) — all covered
- [x] every new case sits under a `describe('chaos: …')` block (so `vitest -t chaos` selects them), families of bad inputs use `test.each`, and undecided behaviour is flagged with `test.todo` or an explicit comment
- [x] npm run check, npm test, npm run build and npm run verify green

### Known gaps (not covered this pass — realism-over-volume call, or genuinely out of scope)

- `runtime:call-tool-response` for a superseded turn (src/background/sw.ts message routing) — no existing test file for sw.ts's routing logic; would need its own chrome.runtime harness, judged lower value than the message races already covered in src/domain/chat and src/infra/chrome-runtime/tab-sync.ts.
- A 401 from an MCP server mid tool-call — lives in src/infra/mcp/streamable-http.ts and legacy-sse.ts, neither of which has a test file yet (also true before this card). Flagged for a future pass; oauth.ts's own 401-adjacent (refresh) paths are already thoroughly tested.
- A missing/invalid provider API key producing a clean `kind:"auth"` error — already implicitly covered by the existing 401/403 error-mapping tests in ollama/client.test.ts and openai/index.test.ts; no NEW test added specifically for "key omitted".
- Timeout-ladder rung-boundary edges — src/infra/webmcp/timeouts.test.ts already exists and was judged adequately covered pre-card; not touched.
- A replayed approval decision (double `approve()`/`deny()` for one id) — `src/sidepanel/stores/approvals.svelte.ts` has NO test file (module-singleton state, needs its own harness) and was judged out of scope for this pass's time budget. `settle()`'s `resolvers.get(id)` guard (approvals.svelte.ts:206-212) already makes a replay a safe no-op by inspection.
- Context-length overflow — no truncation/summarization mechanism exists in the codebase to test against; the tool-result truncation (`MAX_TOOL_RESULT_CHARS`) is the closest analog and is covered.

## Gates

- [x] tests-passing — npm test: 47 files, 720 passed | 2 expected-fail (`it.fails`, both documenting real bugs below) | 2 todo, 0 failures (claude-sonnet, 2026-08-23T08:10:00.000Z)
- [x] typecheck — npm run check: svelte-check + tsc, 1072 files, 0 errors, 0 warnings (claude-sonnet, 2026-08-23T08:10:00.000Z)
- [x] guard — npm run guard: boundaries clean (domain purity, chrome.* containment, chrome.storage containment, chrome.identity containment all ok), clean-code scan 96 markers, nothing above 0.5 (claude-sonnet, 2026-08-23T08:10:00.000Z)
- [x] build — npm run build: green, no errors (claude-sonnet, 2026-08-23T08:10:00.000Z)
- [x] verify — npm run verify: 9/9 required checks passed, 1 best-effort (screenshots) passed (claude-sonnet, 2026-08-23T08:10:00.000Z)

## Comments

- **claude-sonnet** (2026-08-23T08:10:00.000Z): Read the skill, the taxonomy, and skimmed every existing suite before touching anything, to find the genuine gaps rather than re-covering ground the 658 tests already had. Two bugs found and journalled as failing tests (kept asserting CORRECT behaviour, marked `it.fails`, NOT fixed — that's the improvement sprint's job per the card's own instructions):
  1. **Duplicate tool-call ids from the model silently corrupt the SECOND call's result.** `src/domain/chat/message.ts:147-163`'s `toolEntry` keys a transcript entry by `call.id`; `src/domain/chat/service.ts:232-234`'s `findEntry` (and turn.ts's own `TurnTranscript` implementations) resolve `updateToolCallResult(id, ...)` via `Array.prototype.find`, which always returns the FIRST entry sharing that id. If a model (buggy or adversarial) emits two `tool_calls` with the same `id` in one round, the second call's outcome overwrites the FIRST call's already-recorded result, and the second call's own entry is stuck at `"pending"` forever. Failing test: `src/domain/chat/turn.test.ts` — `describe("chaos: duplicate tool-call ids from the model")`.
  2. **A second turn starting for a chat that already has one in flight lets the first turn's completion silently kill the second turn's live/stop registration.** `src/domain/chat/service.ts:450-481`'s `runTurn` keys `liveSessions`/`stopHandlers` by chat id with no per-registration token; its `finally` unconditionally deletes both. Two turns racing for the same chat (double "send" click, a retry fired before the first settled) means the FIRST turn finishing clears the SECOND turn's still-genuinely-active registration — `isTurnActive` reports `false` and `requestStop` silently no-ops for a turn that is still streaming. Failing test: `src/domain/chat/service.test.ts` — `describe("chaos: a second turn starting for a chat that already has one in flight")`.
  New/updated test files (all under `describe('chaos: …')`, `vitest -t chaos` selects them):
  - `src/domain/chat/turn.test.ts` — +6 cases (duplicate ids [fails], partial failure across 3 tool calls, tool-calls-then-terminal-error [+1 todo], stream dies after a successful tool round before new text).
  - `src/domain/chat/service.test.ts` — +6 cases (double in-flight turn [fails], openChat re-attach after concurrent delete, discardIfDeleted mid-turn, syncToTab double-delivery, discardIfDeleted double-delivery).
  - `src/infra/chrome-storage/chat-store.test.ts` — +2 cases (quota exceeded mid-index-write leaves the chat orphaned-but-readable; a debounced write flushing after `deleteChat` resurrects it — documents that the "don't resurrect a deleted chat" guard lives in `ChatService.discardIfDeleted`, not the store).
  - `src/infra/ollama/client.test.ts` — +4 cases (+1 todo) (a connection closing without ever sending `done:true` ends silently with no error signal — flagged as an open question against OpenAI's client, which always finalizes on stream end; garbage JSON on the newline-less flush path; abort mid-stream after partial content).
  - `src/domain/tools/sign-in.test.ts` — NEW file, 16 cases. `./sign-in.ts` (the OAuth sign-in orchestration) had zero test coverage before this card despite being pure, ordering-sensitive domain logic. Covers invalid/declined input, partial permission grants across multiple distinct endpoint origins, registration/flow failures, and manual-client-id edge cases.
  - `src/ui/markdown.test.ts` — NEW file, 25 cases. `./markdown.ts` (the streaming markdown → sanitised HTML pipeline) had zero test coverage before this card despite being the one place untrusted, tool-influenced model output becomes real DOM. Covers HTML/script/attribute injection (all assert rejection, not exploits), unsafe link schemes, unicode/RTL/long-string encoding, and `balanceIncompleteMarkdown` against a battery of pathological mid-stream fragments.
  - `src/infra/chrome-runtime/tab-sync.test.ts` — NEW file, 8 cases. `./tab-sync.ts` (the chrome.tabs/chrome.runtime message-race adapter) had zero test coverage before this card. Covers a stale `runtime:tools-updated` for a tab no longer active, duplicate message delivery, and the `available`/`restricted`/empty-tools three-state model staying distinguishable end to end (including the worker-not-listening-yet degrade path).
  - `src/sidepanel/components/Transcript.test.ts` — +1 case, an end-to-end (real component tree, not the pure function) sanitization check for HTML/script injection riding in assistant content.
  Gaps I deliberately left uncovered, with reasons, are listed on the card body under "Known gaps" rather than buried in this journal.
  Gate results: `npm test` 720 passed / 2 expected-fail / 2 todo / 0 failures; `npm run check` 0 errors; `npm run guard` clean; `npm run build` green; `npm run verify` 9/9 (ran once, solo, at the end per the card's instructions).

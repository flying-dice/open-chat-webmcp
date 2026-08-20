---
column: review
labels: [backend]
priority: high
updatedAt: 2026-08-19T16:40:00.000Z
---
# Agent loop: tool-call orchestration

Ties the model to the page. Send the conversation plus the tab's tool list to the
active provider (decisions/09-provider-agnostic-chat-transport.md), stream the
reply, execute any `tool_calls` through the worker to the page, append results, and
iterate until the model answers with no further calls.

The loop must be able to suspend mid-iteration awaiting a human approval decision
(decisions/05-tool-approval-policy.md) — approval is a promise the call step
awaits, not a separate mode.

## Checklist

- [x] System prompt describing the page and its available tools
- [x] Stream, detect `tool_calls`, dispatch each through the worker
- [x] Append `role: "tool"` results and re-enter the loop
- [x] Max-iteration cap with a clear message when it trips
- [x] Await approval decisions without blocking the stream UI
- [x] Denied call returns a "user denied" tool result so the model recovers
- [x] Tool errors and timeouts feed back as tool results, not thrown exceptions
- [x] Abort mid-loop cleanly when the user hits stop

## Gates

- [x] npm-check — svelte-check + tsc both 0 errors, 124 files (claude, 2026-08-19T16:40:00.000Z)
- [x] npm-build — `npm run build` green, all chunks emitted (claude, 2026-08-19T16:40:00.000Z)

## Comments

- **claude** (2026-08-19T16:40:00.000Z): Implemented the loop in the new
  src/sidepanel/services/agentLoop.ts:1-413 — `runAgentTurn`
  (agentLoop.ts:136-150) builds a system prompt from the page + tool list
  (`buildSystemPrompt`, agentLoop.ts:156-182, checklist item 1), drives
  `provider.chat()` and dispatches `tool_calls` through
  `chrome.runtime.sendMessage("runtime:call-tool")` with a 20s timeout race
  (`callToolWithTimeout`, agentLoop.ts:349-398), appends `role:"tool"`
  results and re-enters the loop (`runLoop`, agentLoop.ts:184-237), caps at
  `MAX_ITERATIONS = 50` (agentLoop.ts) with a clear transcript note when
  it trips (agentLoop.ts:234-236), and never throws — a throwing/timing-out
  tool or a malformed stream both resolve to a tool-result string, never an
  exception (`streamOneTurn`'s catch, agentLoop.ts:239-277;
  `callToolWithTimeout`, agentLoop.ts:349-398). Approval policy
  (decisions/05) lives in `executeToolCall` (agentLoop.ts:283-326):
  `annotations.readOnlyHint === true` auto-runs, everything else —
  including a tool with no annotations, or an unrecognized tool name —
  awaits the injected `ApprovalRequester` seam (agentLoop.ts:77), raced
  against the abort signal so Stop resolves a pending approval as denied
  instead of hanging (`raceApproval`, agentLoop.ts:329-346). **Seam for
  card 09**: `type ApprovalRequester = (request: {call: ToolCall; tool:
  SerializedTool | undefined}) => Promise<"approved" | "denied">`, passed
  as `requestApproval` in `RunAgentTurnOptions` (agentLoop.ts:106-123). The
  DEFAULT is `denyByDefaultApprovalRequester` (agentLoop.ts:87) — always
  denies, so an unwired approval UI fails closed ("the model couldn't
  act"), never auto-approves. A denied call is logged and immediately
  returns "The user denied this tool call." as its tool result
  (agentLoop.ts:300-306), matching the checklist's recovery requirement
  (verified in the fake-loop test, scenario 2).
- **claude** (2026-08-19T16:40:00.000Z): Did the session swap card 07
  documented. src/sidepanel/stores/panel.svelte.ts:1-56 rewrote the module
  doc comment to describe it; `PanelMessage` now `extends ChatMessage`
  (panel.svelte.ts:77-88) so the same object pushed into
  `ChatSession.messages` (typed `ChatMessage[]`) also carries the UI-only
  `id`/`createdAt`/`toolArgs`/`toolStatus` fields, round-tripping through
  `chrome.storage.local` since session.ts persists whatever shape it's
  given — `panel.messages` (panel.svelte.ts:132-135) is a live view over
  that array, and the agent loop passes it straight into
  `ChatParams.messages` with no translation step. Every mutator that
  changes the transcript now ends in `saveSession` — immediate for
  `addUserMessage` (panel.svelte.ts:190-197), `beginAssistantMessage`
  (198-206), `endAssistantMessage` (219-232), `addToolCall` (238-259) and
  `updateToolCallResult` (261-278); debounced (session.ts's own
  DEBOUNCE_MS/MAX_WAIT_MS, no per-token writes) for `appendAssistantDelta`
  (208-215). `addToolCall`/`updateToolCallResult` additionally route
  through `logToolCall`/`completeToolCall` (panel.svelte.ts:255,271-276) so
  card 11's inspector log gets populated alongside the transcript's display
  copy. `resetConversation` is gone, replaced by `syncSessionToTab`
  (161-165)/`applyPanelNavigation` (172-181), which
  src/sidepanel/services/activeTab.ts:62-85 now calls — a genuine behavior
  fix, not just a rename: a real tab switch now loads that tab's *own*
  persisted history instead of wiping the transcript, while a same-tab
  cross-origin nav still resets it, matching decision 07 exactly.
  src/sidepanel/App.svelte:30-59 wires `handleSend` to resolve
  `selection.resolution`/`selection.activeCapability` (read-only import,
  selection.svelte.ts untouched) and hand off to `runAgentTurn`, attaching
  tools only when `activeCapability?.status === "tool-capable"` per
  decisions/11. **Known gap, documented at panel.svelte.ts:44-53**:
  selection.svelte.ts (out of this card's scope) holds its own separate
  `ChatSession` copy for `selectModel()`'s write — switching provider/model
  mid-conversation could in principle overwrite storage with that copy's
  staler message history. Closing it fully needs a change in
  selection.svelte.ts, left for whoever owns that file next.
- **claude** (2026-08-19T16:40:00.000Z): Verified with `npm run check` (0
  errors/warnings across 124 files) and `npm run build` (all chunks
  emitted, no regressions). No API key or local Ollama available, so
  exercised the real loop against a fake `ChatProvider` compiled through
  Vite's `ssrLoadModule` (so the actual Svelte-5-runes store code ran, not a
  reimplementation) with `chrome.storage`/`chrome.runtime` mocked in-memory
  — 29 assertions, all green, covering: a 2-round tool loop where the
  second `provider.chat()` call correctly sees the prior tool result;
  denial via the default requester (tool never runs, model gets "the user
  denied this call" and recovers); a tool with no `annotations` at all
  still requiring approval; an injected custom requester approving a call
  and the approval wait provably happening after streaming had already
  ended (not blocking it); the 8-iteration cap tripping with the exact
  transcript note and exactly 8 tool calls executed; a mid-stream abort via
  the real `requestStop()`/stop-handler seam leaving the partial reply
  intact with no further tool calls or scary error note; and a tool call
  whose transport throws, which came back as a `role:"tool"` error message
  the model read and recovered from, never an uncaught exception. Harness
  and its throwaway vite config were scratch-only (scratchpad dir), not
  committed.

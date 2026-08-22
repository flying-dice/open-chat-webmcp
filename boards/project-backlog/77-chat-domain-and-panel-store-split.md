---
column: todo
labels: [backend, frontend]
priority: high
updatedAt: 2026-08-22T13:20:00.000Z
---
# Chat domain and panel store split

Extract the chat model out of the UI, per
decisions/29-ddd-hexagonal-typescript-layout.md ("the god-store is split along
context lines; UI stores keep only view state") and the layering rules in
`.claude/skills/ddd-hexagonal/SKILL.md`. `src/sidepanel/stores/panel.svelte.ts`
is 1201 lines with ~13 getters, ~11 storage sites and 15 dependents, mixing the
session aggregate, streaming state, page info, tool lists, connection status and
per-tab selection persistence; `src/sidepanel/services/agentLoop.ts` (842) owns
the turn orchestration plus the approval contract that its own consumer imports
back. Two spine problems come with it: `PanelMessage` is persisted as a
`ChatMessage` by structural subtyping and a cast back
(panel.svelte.ts:21-32 and panel.svelte.ts:477-479), and one concept lives in two
stores (`selection.svelte.ts`, 498 lines, imports `getSessionSelection` /
`setSessionSelection` from the panel store).

## Checklist

- [ ] `domain/chat` owns the `ChatSession` aggregate, the turn-phase state machine, transcript grouping and title derivation, with driven ports injected: `ChatStore`, `ModelGateway`, `ToolExecutor`, `ApprovalRequester` — pure decisions stay sync and port-free
- [ ] the turn orchestration moves out of `agentLoop.ts` into `domain/chat` (`runLoop`, `streamOneTurn`, `executeToolCall`, `raceApproval`, `fenceUntrustedContent`, `MAX_ITERATIONS` 8, the "capture the target session once" tab-switch guarantee) with no `chrome.*` left in the loop — its single `chrome.runtime` site (agentLoop.ts:820) moves behind a port
- [ ] `ApprovalRequest` / `ApprovalDecision` / `ApprovalRequester` and `denyByDefaultApprovalRequester` move from `services/agentLoop` into the domain; `src/sidepanel/stores/approvals.svelte.ts` (249) imports them from there, so the contract stops living in its consumer
- [ ] `panel.svelte.ts` shrinks to view state only — streaming buffers, connection status, page info, tool/serverTool lists — keeping the getter-object-over-module-`$state` pattern; every persistence path goes through the injected chat service
- [ ] the `PanelMessage`/`ChatMessage` cast is gone: the domain owns the persisted message shape and the panel maps it to a UI view type carrying the UI-only fields (`id`, `createdAt`, `toolArgs`, `toolStatus`) explicitly
- [ ] per-tab selection persistence leaves the panel store so `selection.svelte.ts` owns the selection concept end to end — one concept, one store
- [ ] `src/sidepanel/lib/chatTitle.ts` (68) and `src/sidepanel/lib/transcriptGroups.ts` (128) take their message type from `domain/chat` instead of importing it from the store
- [ ] npm run check, npm run build, npm run guard and npm run verify green, plus a hands-on pass over tab switching, transcript restore, rename and stop-mid-turn in the real panel

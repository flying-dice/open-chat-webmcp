# domain/chat

The `chat` bounded context (decisions/29-ddd-hexagonal-typescript-layout.md):
the **session aggregate**, the **agent turn**, and everything else that is a
rule about a conversation rather than a rule about where one is stored or how
one is displayed.

Card 74 landed the aggregate and the `ChatStore` port. Card 77 landed the
rest — the context is complete.

| Landed here | Came from | Left behind |
| --- | --- | --- |
| **(card 74)** `ChatSession`, `ChatSummary`, `ToolCallLogEntry`, `ToolCallMode`, `MAX_RETAINED_CHATS`, `createChat`/`logToolCall`/`completeToolCall`/`chatPreview`/`summarizeChat`, and the `ChatStore` port | `src/lib/session.ts` (814 lines, deleted) | its ~24 `chrome.storage.local` call sites, its debounce/flush scheduling and its index mutex — now `src/infra/chrome-storage/chat-store.ts` behind `ChatStore`; and its legacy `session:*` migration, which was deleted, not ported |
| **(card 77)** `TranscriptEntry` — the shape `ChatSession.messages` is actually persisted in — plus `toModelMessage`/`toModelConversation` and `fenceUntrustedContent` (`./message.ts`) | `PanelMessage` in `src/sidepanel/stores/panel.svelte.ts`, and the fencing from `agentLoop.ts` | nothing — this REPLACED a type that was declared in a UI store and smuggled into the aggregate by structural subtyping (see below) |
| **(card 77)** the agent turn: `runTurn`, the iteration cap (`MAX_ITERATIONS` 8), `buildSystemPrompt`, `streamOneTurn`, `executeToolCall`, `raceApproval`, `raceToolCall`, and the capture-the-target-session-once tab-switch guarantee (`./turn.ts`) | `src/sidepanel/services/agentLoop.ts` (842 lines, deleted) | its one `chrome.runtime` round trip → `src/infra/chrome-runtime/page-tool-executor.ts` behind `ToolExecutor`; the timeout-ladder constant and `originLabel`, both now injected |
| **(card 77)** `ChatService` (`./service.ts`) — which chat a tab shows, the swap policy (decision 13), every persistence path, the live-session registry and the stop handlers | the non-view half of `src/sidepanel/stores/panel.svelte.ts` (1,201 → ~330 lines) | the streaming buffers, turn phases, connection status, page info and tool lists, which stayed in the store as view state |
| **(card 77)** `ApprovalRequest`/`ApprovalDecision`/`ApprovalRequester`/`denyByDefaultApprovalRequester`, plus `ModelGateway`, `ToolExecutor` and `ChatPresenter` (`./ports.ts`) | `agentLoop.ts`, which declared the approval contract its own consumer imported back | the approval QUEUE and its skip-lists, which stay in `src/sidepanel/stores/approvals.svelte.ts` |
| **(card 77)** title derivation (`./title.ts`) | `src/sidepanel/lib/chatTitle.ts` (deleted) | nothing — already pure |
| **(card 77)** transcript grouping (`./transcript-groups.ts`) | `src/sidepanel/lib/transcriptGroups.ts` (deleted) | nothing — already pure, but it typed itself against the panel store's `PanelMessage`; it now takes `TranscriptEntry` |
| **(card 77)** `TurnPhase` (`./turn-phase.ts`) | `src/sidepanel/stores/panel.svelte.ts` | the per-chat maps that hold live phases, which are view state |

The auto-run approval POLICY is deliberately NOT here: decisions/20 keeps the
page rule and the server rule as two separate units, and they belong with the
policy values they read — `src/domain/settings`. This context asks the
`ApprovalPolicyGate` and, if the answer is no, asks the human.

## The cast that is gone

`ChatSession.messages` used to be typed `ChatMessage[]` (the PROVIDER wire
shape) while everything stored in it was a `PanelMessage` — a `ChatMessage`
plus `id`, `createdAt`, `toolArgs`, `toolStatus`, `toolMode`, three annotation
snapshots and `actions`. It worked by structural subtyping going in and a cast
coming out, so the aggregate declared strictly less than it stored and the real
persisted shape lived in a Svelte store. `ChatSession.selectionExplicit` was
the same trick on the same object, through a second cast.

Both are declared fields now, and `toModelMessage` is the one place the
transcript vocabulary meets the provider's — narrowing field by field, so UI-only
data can no longer ride along to a provider on every request of every turn.

## Layering

Nothing here may import `chrome.*`, `fetch`, the DOM, or Svelte — including the
turn, which is why the tool-call round trip, the timeout constant and the
origin wording are all injected. `index.ts` is the context's only public face.

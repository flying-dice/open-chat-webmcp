# domain/chat

The `chat` bounded context (decisions/29-ddd-hexagonal-typescript-layout.md):
the **session aggregate** and everything that is a rule about a conversation
rather than a rule about where one is stored.

Card 74 landed the aggregate and the `ChatStore` port. What is still to come
(card 77) is marked below.

| Landed / lands here | Comes from | Left behind |
| --- | --- | --- |
| **(card 74)** `ChatSession`, `ChatSummary`, `ToolCallLogEntry`, `ToolCallMode`, `MAX_RETAINED_CHATS`, `createChat`/`logToolCall`/`completeToolCall`/`chatPreview`/`summarizeChat`, and the `ChatStore` port | `src/lib/session.ts` (814 lines, deleted) | its ~24 `chrome.storage.local` call sites, its debounce/flush scheduling and its index mutex — now `src/infra/chrome-storage/chat-store.ts` behind `ChatStore`; and its legacy `session:*` migration, which was deleted, not ported |
| *(card 77)* the agent-turn policy (iteration cap, approval decisions, untrusted-content fencing rules) | `src/sidepanel/services/agentLoop.ts` (842 lines) | the `chrome.runtime` round trip and the streaming plumbing |
| *(card 77)* title derivation | `src/sidepanel/lib/chatTitle.ts` | nothing — already pure |
| *(card 77)* transcript grouping | `src/sidepanel/lib/transcriptGroups.ts` | nothing — already pure, but must stop typing itself against the panel store's `PanelMessage` |

Nothing here may import `chrome.*`, `fetch`, the DOM, or Svelte. `index.ts`
is the context's only public face.

# domain/chat — placeholder

The `chat` bounded context (decisions/29-ddd-hexagonal-typescript-layout.md):
the **session aggregate** and everything that is a rule about a conversation
rather than a rule about where one is stored.

What lands here (cards 74-79), and from where:

| Lands here | Comes from | Leaves behind |
| --- | --- | --- |
| `ChatSession`, `ChatSummary`, `ToolCallLogEntry`, `ToolCallMode`, transcript/turn-phase reducers, retention policy | `src/lib/session.ts` (814 lines) | its ~24 `chrome.storage.local` call sites, its debounce/flush scheduling and its index mutex — those become `src/infra/chrome-storage`'s `ChatStore` adapter behind a port declared here |
| the agent-turn policy (iteration cap, approval decisions, untrusted-content fencing rules) | `src/sidepanel/services/agentLoop.ts` (842 lines) | the `chrome.runtime` round trip and the streaming plumbing |
| title derivation | `src/sidepanel/lib/chatTitle.ts` | nothing — already pure |
| transcript grouping | `src/sidepanel/lib/transcriptGroups.ts` | nothing — already pure, but must stop typing itself against the panel store's `PanelMessage` |

Nothing here may import `chrome.*`, `fetch`, the DOM, or Svelte. `index.ts`
is the context's only public face.

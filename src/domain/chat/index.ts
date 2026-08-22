// `chat` bounded context (decisions/29-ddd-hexagonal-typescript-layout.md):
// the session aggregate — `ChatSession`, its tool-call log, the retention
// cap and the summary/preview derivation — plus `ChatStore`, the driven port
// that says what the context needs from the world to keep a conversation.
//
// Card 74 landed the aggregate and the port; the turn policy still to come
// from src/sidepanel/services/agentLoop.ts is card 77's (see ./README.md).
//
// Pure TypeScript — no `chrome.*`, no `fetch`, no DOM, no Svelte. The
// `chrome.storage` implementation of `ChatStore` is an adapter and lives in
// src/infra/chrome-storage.
//
// This barrel is the context's public face: other contexts and the outer
// layers import `src/domain/chat`, never a file inside it.

export * from "./session";
export * from "./store";

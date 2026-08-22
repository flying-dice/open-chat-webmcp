// `chat` bounded context (decisions/29-ddd-hexagonal-typescript-layout.md).
//
// Card 74 landed the session aggregate and `ChatStore`. Card 77 landed the
// rest of the context — everything that is a rule about a CONVERSATION rather
// than about the panel that displays one:
//
//   ./message.ts           the persisted transcript entry, and the ONE
//                          mapping from it to a provider's `ChatMessage`
//                          (fencing untrusted tool results on the way out)
//   ./page-context.ts      what the user explicitly shared FROM the page — a
//                          selection or a capped text extract — and the
//                          pull-only port that fetches it (card 118,
//                          decisions/40)
//   ./session.ts           the `ChatSession` aggregate, its tool-call log,
//                          the retention cap, the summary/preview derivation
//   ./title.ts             what a chat is called (explicit name, else derived)
//   ./transcript-groups.ts how a flat transcript reads as user turns, prose
//                          turns and activity groups
//   ./turn-phase.ts        the four phases a turn passes through
//   ./turn.ts              the agent turn itself — the iteration cap, the
//                          approval gating, the untrusted-content fencing,
//                          the tool-call race
//   ./service.ts           `ChatService`, the driving port: which chat a tab
//                          shows, what happens when that changes, and every
//                          path that persists one
//   ./store.ts, ./ports.ts the driven ports — `ChatStore`, `ModelGateway`,
//                          `ToolExecutor`, `ApprovalRequester`,
//                          `ChatPresenter`
//
// Pure TypeScript — no `chrome.*`, no `fetch`, no DOM, no Svelte. The
// `chrome.storage` implementation of `ChatStore` and the `chrome.runtime`
// implementation of a page tool's executor are adapters and live in
// src/infra/chrome-storage and src/infra/chrome-runtime.
//
// This barrel is the context's public face: other contexts and the outer
// layers import `src/domain/chat`, never a file inside it.

export * from "./message";
export * from "./page-context";
export * from "./ports";
export * from "./service";
export * from "./session";
export * from "./store";
export * from "./title";
export * from "./transcript-groups";
export * from "./turn";
export * from "./turn-phase";

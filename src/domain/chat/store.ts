// `ChatStore` — the driven port for chat persistence (card 74,
// decisions/29-ddd-hexagonal-typescript-layout.md). The `chat` context
// declares what it needs from the world; `src/infra/chrome-storage`'s
// `createChromeStorageChatStore` is the one implementation today.
//
// The port deliberately keeps the WRITE SCHEDULING in its contract rather
// than hiding it: `save` normally only *schedules* a write, and
// `flush`/`flushAll` force one. That is not a leaked storage detail — a
// caller streaming tokens into a session has to know that closing the panel
// mid-stream loses the tail unless it flushes, and decisions/07's debounced
// write is a stated property of how chat history behaves, not an
// implementation the domain is indifferent to. What the port does NOT say
// is how long the debounce is, where the bytes go, or how the index is kept
// consistent — those are the adapter's.
//
// Every method rejects with `StorageError` (src/domain/storage) and nothing
// else.

import type { ChatSession, ChatSummary } from "./session";

/** How a {@link ChatStore.save} should be scheduled. */
export interface ChatSaveOptions {
  /** Bypass debouncing and write now — for a chat's first save, or any point where losing the write to a closed panel would be surprising rather than expected. */
  immediate?: boolean;
  /**
   * Whether to stamp `updatedAt` (decisions/24 §5). Defaults to `true`.
   * Renaming passes `false`: History is ordered by `updatedAt`, and
   * relabelling a chat is not conversation activity — a rename jumping the
   * chat to the top of the list would be surprising.
   */
  touch?: boolean;
}

/** What a tab's pointer resolved to (decisions/25 §2, card 57) — see {@link ChatStore.getOrCreateChatForTab}. */
export interface ResolvedTabChat {
  chat: ChatSession;
  /**
   * `true` when `chat` came from an ALREADY-CORRECT tab pointer, `false`
   * when it is a freshly minted, unsaved chat. A resolved pointer is correct
   * by construction and the caller must not rewrite it; an unresolved one's
   * pointer MUST be written once the chat has content, or every later
   * message the tab sends has nowhere to be found.
   */
  resolved: boolean;
}

/**
 * Persistence for the chat aggregate: one chat by id, the global history
 * list, and each tab's soft pointer at the chat it currently shows.
 */
export interface ChatStore {
  /** Fetch one chat by id — for opening a history entry. `undefined` if it was deleted, never existed, or is stored in a shape the aggregate does not recognise (all three are "not available" to a caller; only the last is worth a log line, which the adapter writes). */
  getChat(chatId: string): Promise<ChatSession | undefined>;

  /**
   * Resolve `tabId`'s CURRENT chat: follow the tab's stored pointer if one
   * exists, was set against `currentOrigin` (the guard against a recycled
   * tab id) and still resolves to a real chat. Otherwise return a fresh,
   * UNSAVED chat — this writes nothing.
   */
  getOrCreateChatForTab(tabId: number, currentOrigin: string): Promise<ResolvedTabChat>;

  /** Point `tabId` at `chatId`. `tabOrigin` is the TAB's current origin, not the chat's own `origin` (which may legitimately differ — decision 13's cross-origin-open case). A small immediate write; safe on every tab switch. */
  setCurrentChatForTab(tabId: number, chatId: string, tabOrigin: string): Promise<void>;

  /** Persist `session`. Debounced unless `opts.immediate` — see {@link ChatSaveOptions} and this module's header. */
  save(session: ChatSession, opts?: ChatSaveOptions): Promise<void>;

  /** Force any pending debounced write for `chatId` to commit now. Resolves immediately when nothing is pending. */
  flush(chatId: string): Promise<void>;

  /** {@link ChatStore.flush} for every chat with a pending write — one teardown call site that shouldn't need to know which chats are dirty. */
  flushAll(): Promise<void>;

  /** Discard one chat entirely: any pending write, the stored chat, its history entry, and any tab pointer that targeted it. Nothing about it remains. */
  deleteChat(chatId: string): Promise<void>;

  /** Discard every stored chat and every tab's pointer (the options page's "clear all history"). */
  clearAllChats(): Promise<void>;

  /** Every stored chat's lightweight summary, newest first. Never loads a chat's messages. */
  listChatSummaries(): Promise<ChatSummary[]>;
}

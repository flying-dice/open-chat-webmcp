// `chrome.storage.local` implementation of `ChatStore` (src/domain/chat) —
// decisions/07-session-state-and-persistence.md as revised by
// decisions/13-global-tab-aware-chat-history.md.
//
// Storage shape (unencrypted — decisions/07, 10, 13):
//   - `chat:<chatId>`   → one `ChatSession`
//   - `chat:index`      → `ChatIndexEntry[]`, one lightweight entry per chat
//     (origin, timestamps, message/tool-call counts, a short preview of the
//     first user message). `listChatSummaries` reads ONLY this, so listing
//     every chat for a history UI never loads every chat's messages.
//   - `tabchat:<tabId>` → `{chatId, tabOrigin}`, the tab's pointer to its
//     CURRENT chat. `tabOrigin` is the tab's own origin at the moment the
//     pointer was set — purely a guard against a recycled tab id resuming
//     whatever chat used to live in that slot. A chat's own `origin` does
//     NOT have to match the tab it is viewed from (decision 13 explicitly
//     allows that), which is why the guard is on the pointer, not the chat.
//
// LEGACY MIGRATION: deleted, not ported (card 74, and the pre-release
// no-migrations rule). The `session:<tabId>` / `session:index` keyspace and
// the `chat:migrated-from-tab-sessions:v1` flag that guarded the one-time
// conversion are gone, along with the `migrateLegacySessionsOnce()` call
// that stood at the top of five of the entry points below. Nothing reads or
// writes those keys any more; any that survive in a developer profile are
// inert bytes.

import {
  chatPreview,
  createChat,
  MAX_RETAINED_CHATS,
  type ChatSaveOptions,
  type ChatSession,
  type ChatStore,
  type ChatSummary,
  type ResolvedTabChat,
} from "../../domain/chat";
import type { ChatMessage, ProviderSelection } from "../../domain/providers";
import { isRecord, type StorageAreaGateway } from "./area";

/** Debounce window: a write is scheduled this long after the *last* change. Short enough that closing the panel soon after a stream ends still lands via the max-wait fallback below, not just this timer. */
const DEBOUNCE_MS = 400;

/** Upper bound on how long a change can sit unwritten during a continuous stream of changes (token-by-token streaming keeps resetting the plain debounce timer). Guarantees a write lands at least this often even under constant activity. */
const MAX_WAIT_MS = 2000;

const CHAT_KEY_PREFIX = "chat:";
const CHAT_INDEX_KEY = "chat:index";
const TAB_POINTER_PREFIX = "tabchat:";

function chatStorageKey(chatId: string): string {
  return `${CHAT_KEY_PREFIX}${chatId}`;
}

function tabPointerKey(tabId: number): string {
  return `${TAB_POINTER_PREFIX}${tabId}`;
}

// ---------------------------------------------------------------------------
// Defensive parsing — drop anything that doesn't look right rather than
// letting corrupted or foreign-written storage crash a consumer downstream.
// ---------------------------------------------------------------------------

function isToolCallMode(v: unknown): boolean {
  return v === "auto" || v === "approved" || v === "denied";
}

function isToolCallLogEntry(v: unknown): boolean {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    isRecord(v.arguments) &&
    isToolCallMode(v.mode) &&
    typeof v.startedAt === "number" &&
    (v.endedAt === undefined || typeof v.endedAt === "number") &&
    (v.error === undefined || typeof v.error === "string")
  );
}

function isChatMessageLike(v: unknown): v is ChatMessage {
  return isRecord(v) && typeof v.role === "string" && typeof v.content === "string";
}

function isProviderSelectionLike(v: unknown): v is ProviderSelection {
  return isRecord(v) && typeof v.providerId === "string" && typeof v.model === "string";
}

function isChatSession(v: unknown): v is ChatSession {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.origin === "string" &&
    Array.isArray(v.messages) &&
    v.messages.every(isChatMessageLike) &&
    (v.selection === undefined || isProviderSelectionLike(v.selection)) &&
    Array.isArray(v.toolCalls) &&
    v.toolCalls.every(isToolCallLogEntry) &&
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number" &&
    (v.title === undefined || typeof v.title === "string")
  );
}

/**
 * Names the first field that fails {@link isChatSession}'s validation, for
 * {@link readChatRaw}'s warning (card 59 item 4). Mirrors `isChatSession`'s
 * own checks, in the same order, so the two can never silently drift apart —
 * only ever called after `isChatSession(v)` has already returned `false`, so
 * falling through every check below is not expected in practice, but still
 * returns a name rather than throwing: a diagnostic helper crashing would be
 * worse than the silent loss this exists to replace.
 */
function firstInvalidChatSessionField(v: unknown): string {
  if (!isRecord(v)) return "(not an object)";
  if (typeof v.id !== "string") return "id";
  if (typeof v.origin !== "string") return "origin";
  if (!Array.isArray(v.messages)) return "messages (not an array)";
  if (!v.messages.every(isChatMessageLike)) return "messages (an entry failed isChatMessageLike)";
  if (v.selection !== undefined && !isProviderSelectionLike(v.selection)) return "selection";
  if (!Array.isArray(v.toolCalls)) return "toolCalls (not an array)";
  if (!v.toolCalls.every(isToolCallLogEntry)) return "toolCalls (an entry failed isToolCallLogEntry)";
  if (typeof v.createdAt !== "number") return "createdAt";
  if (typeof v.updatedAt !== "number") return "updatedAt";
  if (v.title !== undefined && typeof v.title !== "string") return "title";
  return "(unknown — isChatSession failed but no individual check here did; the two have drifted apart)";
}

/** `ChatSummary` is what a caller gets; this is the same data as it sits in `chat:index`. They are kept identical on purpose — the index IS the summary list, so a divergence would be a second shape to migrate. */
type ChatIndexEntry = ChatSummary;

function isChatIndexEntry(v: unknown): v is ChatIndexEntry {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.origin === "string" &&
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number" &&
    typeof v.messageCount === "number" &&
    typeof v.toolCallCount === "number" &&
    (v.preview === undefined || typeof v.preview === "string") &&
    (v.title === undefined || typeof v.title === "string")
  );
}

interface TabPointer {
  chatId: string;
  tabOrigin: string;
}

function isTabPointer(v: unknown): v is TabPointer {
  return isRecord(v) && typeof v.chatId === "string" && typeof v.tabOrigin === "string";
}

/**
 * Deep-clones `value` into plain data with no `Proxy` anywhere in its graph.
 *
 * CARD 55: the panel's live `session` is ALWAYS a Svelte 5 `$state` reactive
 * Proxy, and every write this store accepts is that same live object (never
 * a copy). `chrome.storage.local.set`'s own argument serializer does NOT
 * spec-correctly unwrap a Proxy's array-ness the way `Array.isArray` /
 * `JSON.stringify` do — verified empirically in a real built extension:
 * writing a `$state`-proxied `ChatSession` straight through round-trips its
 * `messages`/`toolCalls` arrays back as numeric-keyed OBJECTS (`{"0": {...}}`),
 * not arrays. That silently fails `isChatSession`'s `Array.isArray` checks on
 * every later read, which is what produced both reported symptoms (history
 * entries that did nothing when opened, and the transcript resetting to
 * empty on every tab switch).
 *
 * `JSON.stringify`/`JSON.parse` is the deliberate choice, not
 * `structuredClone`: `JSON.stringify` DOES correctly unwrap a Proxy's exotic
 * array-ness, while `structuredClone` cannot clone a `$state` proxy at all —
 * it throws "could not be cloned" outright. Every `ChatSession` field (and
 * every UI-only extra riding along on top) is already JSON-safe, so this is
 * lossless for real data.
 *
 * This is the single choke point: the immediate path, the debounced flush
 * path (which holds a reference to the same live proxy) and everything else
 * funnel through `commit`, so no writer can regress it by forgetting to
 * snapshot first.
 */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface PendingWrite {
  session: ChatSession;
  timer: ReturnType<typeof setTimeout>;
  maxTimer: ReturnType<typeof setTimeout>;
}

export function createChromeStorageChatStore(local: StorageAreaGateway): ChatStore {
  // -------------------------------------------------------------------------
  // Per-store mutable state. Both maps live only as long as the surface that
  // built the store does — which is the whole reason `flushAll` exists for a
  // teardown call site to use.
  // -------------------------------------------------------------------------

  const pending = new Map<string, PendingWrite>();

  /**
   * Index write serialization (card 55): the `chat:index` read-modify-write
   * used to be unserialized, and two concurrent commits for DIFFERENT chats
   * are routine on a tab switch — the outgoing tab's chat may still have a
   * debounced write in flight while the incoming tab's chat commits
   * immediately. Both read the index before either wrote it back, so the
   * second write silently dropped the first chat's entry: its `chat:<id>`
   * record survived, but it became permanently invisible to
   * `listChatSummaries`. Every operation that reads-then-writes the index
   * funnels through this one queue so they can never interleave.
   */
  let indexQueue: Promise<void> = Promise.resolve();

  /**
   * Runs `fn` only after every previously queued index operation has settled
   * (success or failure), and advances the queue regardless of `fn`'s own
   * outcome so one rejected operation can never wedge every later one. NOT
   * reentrant — never call this from inside another `withIndexLock` callback
   * (that is exactly why {@link evictIfNeededLocked} exists: so `commit` can
   * share ONE lock acquisition for both the index update and eviction
   * instead of nesting two).
   */
  function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = indexQueue.then(fn, fn);
    indexQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readChatIndex(): Promise<ChatIndexEntry[]> {
    const value = await local.read(CHAT_INDEX_KEY);
    return Array.isArray(value) ? value.filter(isChatIndexEntry) : [];
  }

  async function writeChatIndex(list: ChatIndexEntry[]): Promise<void> {
    await local.write({ [CHAT_INDEX_KEY]: list });
  }

  /**
   * `undefined` covers two very different situations that used to be
   * indistinguishable to every caller (card 59 item 4): "no such chat"
   * (never existed, or was legitimately deleted — expected, silent, fine)
   * versus "a record exists but fails `isChatSession`" (a permanent,
   * otherwise-silent loss). The return value is `undefined` either way,
   * deliberately — no caller is meant to treat "corrupt" differently from
   * "absent" for control flow — but the SECOND case logs a warning naming
   * the chat id and the first field that failed, so a report can point at it
   * instead of inferring it from a full storage dump. This is also why a
   * corrupt record does not raise `StorageError`'s `Corrupt`: raising would
   * turn a recoverable "that one chat is gone" into a failed history listing.
   */
  async function readChatRaw(chatId: string): Promise<ChatSession | undefined> {
    const value = await local.read(chatStorageKey(chatId));
    if (value === undefined) return undefined;
    if (isChatSession(value)) return value;
    console.warn(
      `[webmcp][chat-store] chat ${chatId} exists in storage but failed isChatSession validation (first bad field: ${firstInvalidChatSessionField(value)})`,
    );
    return undefined;
  }

  async function readTabPointer(tabId: number): Promise<TabPointer | undefined> {
    const value = await local.read(tabPointerKey(tabId));
    return isTabPointer(value) ? value : undefined;
  }

  /** Removes every `tabchat:*` pointer that targets one of `chatIds` — used when a chat is deleted (explicitly or by the backstop eviction) so a stale pointer can never resurrect it or hand a tab a chat id that no longer resolves to anything. */
  async function removeTabPointersFor(chatIds: ReadonlySet<string>): Promise<void> {
    if (chatIds.size === 0) return;
    const all = await local.readAll();
    const stale = Object.keys(all).filter((k) => {
      if (!k.startsWith(TAB_POINTER_PREFIX)) return false;
      const v = all[k];
      return isTabPointer(v) && chatIds.has(v.chatId);
    });
    await local.remove(stale);
  }

  /**
   * Backstop eviction (see `MAX_RETAINED_CHATS` in src/domain/chat): drops
   * the oldest chats by `updatedAt`, and only once the retained count
   * exceeds the cap. Not the primary way chats go away — explicit deletion
   * is. Assumes the caller already holds the index lock.
   */
  async function evictIfNeededLocked(): Promise<void> {
    const index = await readChatIndex();
    if (index.length <= MAX_RETAINED_CHATS) return;

    const sorted = [...index].sort((a, b) => a.updatedAt - b.updatedAt);
    const evictCount = sorted.length - MAX_RETAINED_CHATS;
    const toEvict = sorted.slice(0, evictCount);
    const toKeep = sorted.slice(evictCount);

    await local.remove(toEvict.map((e) => chatStorageKey(e.id)));
    await writeChatIndex(toKeep);
    await removeTabPointersFor(new Set(toEvict.map((e) => e.id)));
  }

  async function commit(session: ChatSession): Promise<void> {
    const plain = toPlain(session);
    await local.write({ [chatStorageKey(plain.id)]: plain });

    await withIndexLock(async () => {
      const index = await readChatIndex();
      const nextIndex = index.filter((e) => e.id !== plain.id);
      nextIndex.push({
        id: plain.id,
        origin: plain.origin,
        createdAt: plain.createdAt,
        updatedAt: plain.updatedAt,
        messageCount: plain.messages.length,
        toolCallCount: plain.toolCalls.length,
        preview: chatPreview(plain.messages),
        title: plain.title,
      });
      await writeChatIndex(nextIndex);
      await evictIfNeededLocked();
    });
  }

  function clearPending(chatId: string): void {
    const entry = pending.get(chatId);
    if (!entry) return;
    clearTimeout(entry.timer);
    clearTimeout(entry.maxTimer);
    pending.delete(chatId);
  }

  const store: ChatStore = {
    getChat(chatId) {
      return readChatRaw(chatId);
    },

    async getOrCreateChatForTab(tabId, currentOrigin): Promise<ResolvedTabChat> {
      const pointer = await readTabPointer(tabId);
      if (pointer && pointer.tabOrigin === currentOrigin) {
        const chat = await readChatRaw(pointer.chatId);
        if (chat) return { chat, resolved: true };
      }
      // `resolved: false` on a pointer whose target is missing or corrupt is
      // deliberate (decisions/25 §2): a fresh chat's pointer MUST be written
      // in that case, or every subsequent message the tab sends has nowhere
      // to be found and is silently lost too.
      return { chat: createChat(currentOrigin), resolved: false };
    },

    async setCurrentChatForTab(tabId, chatId, tabOrigin) {
      await local.write({
        [tabPointerKey(tabId)]: { chatId, tabOrigin } satisfies TabPointer,
      });
    },

    async save(session: ChatSession, opts: ChatSaveOptions = {}) {
      if (opts.touch ?? true) session.updatedAt = Date.now();

      if (opts.immediate) {
        clearPending(session.id);
        await commit(session);
        return;
      }

      const existing = pending.get(session.id);
      if (existing) clearTimeout(existing.timer);

      const timer = setTimeout(() => {
        void store.flush(session.id);
      }, DEBOUNCE_MS);

      // The max-wait timer is NOT re-armed on a subsequent change — it is
      // carried over from the first pending change, which is what bounds how
      // long a continuous token stream can starve the trailing-edge timer.
      const maxTimer =
        existing?.maxTimer ??
        setTimeout(() => {
          void store.flush(session.id);
        }, MAX_WAIT_MS);

      pending.set(session.id, { session, timer, maxTimer });
    },

    async flush(chatId) {
      const entry = pending.get(chatId);
      if (!entry) return;
      clearPending(chatId);
      await commit(entry.session);
    },

    async flushAll() {
      await Promise.all([...pending.keys()].map((chatId) => store.flush(chatId)));
    },

    async deleteChat(chatId) {
      clearPending(chatId);
      await local.remove(chatStorageKey(chatId));

      await withIndexLock(async () => {
        const index = await readChatIndex();
        await writeChatIndex(index.filter((e) => e.id !== chatId));
      });

      await removeTabPointersFor(new Set([chatId]));
    },

    async clearAllChats() {
      for (const chatId of [...pending.keys()]) clearPending(chatId);

      await withIndexLock(async () => {
        const all = await local.readAll();
        const keysToRemove = Object.keys(all).filter(
          (k) => k.startsWith(CHAT_KEY_PREFIX) || k.startsWith(TAB_POINTER_PREFIX),
        );
        await local.remove(keysToRemove);
      });
    },

    async listChatSummaries() {
      const index = await readChatIndex();
      return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
    },
  };

  return store;
}

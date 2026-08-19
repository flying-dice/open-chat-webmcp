// Global chat history persistence (decisions/13-global-tab-aware-chat-history.md,
// which REVISES decisions/07-session-state-and-persistence.md's session
// identity, cross-origin reset, and eviction — the rest of decision 07
// stands: storage is still `chrome.storage.local`, writes are still
// debounced, history is still unencrypted and may contain authenticated
// page content, and the single-owner invariant for the in-memory session
// object (card 29) still holds).
//
// A pure, UI-free storage module. The unit of identity is now a CHAT, not a
// tab: each `ChatSession` has its own `id`, is listed globally, and records
// the origin it was started against. A tab no longer OWNS a session — it
// holds a soft POINTER to whichever chat it currently shows. This module
// owns *when to write and what to keep*; it deliberately does not own *when
// a navigation or tab switch happened*, or the decision to retire the
// current chat and start a fresh one on cross-origin navigation — that
// policy lives in src/sidepanel/stores/panel.svelte.ts (the sole in-memory
// session owner, see its module doc comment), which is the only caller that
// knows a real navigation happened versus, say, a history entry being
// opened deliberately against a different-origin tab.
//
// Storage shape (`chrome.storage.local`, unencrypted — decisions/07, 10, 13):
//   - `chat:<chatId>`   → one `ChatSession`
//   - `chat:index`      → `ChatIndexEntry[]`, one lightweight entry per
//     chat (origin, timestamps, message/tool-call counts, and a short
//     preview of the first user message) — this is what `listChatSummaries`
//     reads, so listing every chat for a history UI never needs to load
//     every chat's full message history.
//   - `tabchat:<tabId>` → `{chatId, tabOrigin}`, the tab's pointer to its
//     *current* chat. `tabOrigin` is the tab's own origin at the moment the
//     pointer was set — purely a guard against a recycled tab id resuming
//     whatever chat used to live in that slot (decision 07's original
//     recycled-tab-id guard, now applied to the pointer instead of the chat
//     itself, since a chat's own `origin` no longer has to match the tab
//     it's being viewed from — decision 13 explicitly allows that).
//
// Eviction (decision 13): count-based eviction ("drop the oldest once you
// have N") is gone as the *primary* mechanism — a history feature whose
// entries vanish on their own is worse than no history. Deletion
// (`deleteChat`/`clearAllChats`) is now the deliberate, explicit way chats
// go away. `MAX_RETAINED_CHATS` still exists as a much higher backstop cap,
// purely to keep storage bounded if a user genuinely never deletes anything
// — see `evictIfNeeded`'s doc comment.
//
// MIGRATION (decision 13's "real decision, not an accident"): sessions from
// before this change are stored under the old `session:<tabId>` keyspace.
// `migrateLegacySessionsOnce` converts every legacy session that has actual
// message content into a new `ChatSession` under a freshly minted id, points
// the originating tab at it (best-effort — only useful if that tab id still
// shows the same origin), and then deletes the old keys. This runs lazily,
// at most once (guarded by a stored flag), the first time any of this
// module's chat-storage entry points is called. See the doc comment on
// `runMigration` for why conversion was chosen over discarding.
//
// Writes are debounced per chat (`DEBOUNCE_MS` of inactivity, capped by
// `MAX_WAIT_MS` so a long token stream still lands periodically rather than
// starving the debounce indefinitely) — see `saveSession`. The pending-write
// map lives only in this module's memory, which lives only as long as the
// panel does; `flushSession`/`flushAllSessions` are exposed so the panel can
// force a synchronous write on unload/visibility-change and not lose the
// tail of a streamed message. That wiring is the panel's job, not this
// module's.

import type { ChatMessage } from "./provider";
import type { ToolOrigin } from "./mcp/merge";
import {
  resolveSelection,
  type ProviderSelection,
  type SelectionResolution,
} from "./providers/registry";

export type { SelectionResolution } from "./providers/registry";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/** Whether a logged tool call ran without asking, was explicitly approved, or was denied — what the inspector (card 11) branches on. */
export type ToolCallMode = "auto" | "approved" | "denied";

/**
 * One entry in a chat's tool-call log: name, arguments, result or error,
 * timing, and the approval mode. Created via {@link logToolCall} (denied
 * calls never run — record them directly, no {@link completeToolCall}
 * needed) and finished via {@link completeToolCall}.
 */
export interface ToolCallLogEntry {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  mode: ToolCallMode;
  /**
   * Where this call ran (decisions/19 §6: the call log must show it
   * alongside args/result, not just imply it via the namespaced name).
   * `undefined` for a call logged before this field existed, or for the
   * rare hallucinated-tool-name case where the model named something not in
   * this turn's tool list at all — the UI treats an absent origin as
   * unknown, never as "the page" by default.
   */
  origin?: ToolOrigin;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

/**
 * One chat: its own identity, history, provider+model selection, and
 * tool-call log (decision 13). No longer keyed by or tied to a tab — see
 * this module's header comment. `origin` is recorded once, at creation, and
 * is the origin the history list shows next to this chat; it does NOT
 * change if the chat is later opened against a different-origin tab
 * (decision 13's "opening a chat in a tab whose origin differs... is
 * allowed").
 */
export interface ChatSession {
  id: string;
  /** The origin this chat was STARTED against. */
  origin: string;
  messages: ChatMessage[];
  /** `{providerId, model}` — same shape as the global default (decisions/10). Absent until the user picks one. */
  selection?: ProviderSelection;
  toolCalls: ToolCallLogEntry[];
  createdAt: number;
  updatedAt: number;
}

/** Lightweight view of a chat for a history list (the panel's History view and the options page's "clear history" section) — no message bodies, so listing every chat stays cheap even at a high retention cap. Sourced entirely from `chat:index`, never by reading every chat's full record. */
export interface ChatSummary {
  id: string;
  origin: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  toolCallCount: number;
  /** The first user message's content, trimmed and truncated — enough to recognise the chat in a list. `undefined` if the chat has no user message yet (an empty or assistant-only chat). */
  preview?: string;
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Debounce window: a write is scheduled this long after the *last* change. Short enough that closing the panel soon after a stream ends still lands via the max-wait fallback below, not just this timer. */
const DEBOUNCE_MS = 400;

/** Upper bound on how long a change can sit unwritten during a continuous stream of changes (e.g. token-by-token streaming, which keeps resetting the plain debounce timer). Guarantees a write lands at least this often even under constant activity. */
const MAX_WAIT_MS = 2000;

/**
 * Backstop cap on retained chats (decision 13: "eviction by count is
 * replaced with explicit deletion plus a much higher cap"). Deletion —
 * `deleteChat`/`clearAllChats` — is the intended, user-visible way chats go
 * away now; this cap only exists so storage stays bounded for a user who
 * never deletes anything. 20x the old per-tab cap (which was itself sized
 * for a handful of tabs, not a lifetime of history), so it should not be
 * something an ordinary user runs into in practice — `evictIfNeeded` only
 * fires past this as a last resort.
 */
export const MAX_RETAINED_CHATS = 400;

const CHAT_KEY_PREFIX = "chat:";
const CHAT_INDEX_KEY = "chat:index";
const TAB_POINTER_PREFIX = "tabchat:";
const MIGRATION_FLAG_KEY = "chat:migrated-from-tab-sessions:v1";

function chatStorageKey(chatId: string): string {
  return `${CHAT_KEY_PREFIX}${chatId}`;
}

function tabPointerKey(tabId: number): string {
  return `${TAB_POINTER_PREFIX}${tabId}`;
}

function makeChatId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Defensive parsing — mirrors the pattern in src/lib/providers/registry.ts:
// drop anything that doesn't look right rather than letting corrupted or
// foreign-written storage crash a consumer downstream.
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isToolCallMode(v: unknown): v is ToolCallMode {
  return v === "auto" || v === "approved" || v === "denied";
}

function isToolCallLogEntry(v: unknown): v is ToolCallLogEntry {
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
    typeof v.updatedAt === "number"
  );
}

interface ChatIndexEntry {
  id: string;
  origin: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  toolCallCount: number;
  preview?: string;
}

function isChatIndexEntry(v: unknown): v is ChatIndexEntry {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.origin === "string" &&
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number" &&
    typeof v.messageCount === "number" &&
    typeof v.toolCallCount === "number" &&
    (v.preview === undefined || typeof v.preview === "string")
  );
}

interface TabPointer {
  chatId: string;
  tabOrigin: string;
}

function isTabPointer(v: unknown): v is TabPointer {
  return isRecord(v) && typeof v.chatId === "string" && typeof v.tabOrigin === "string";
}

/** Trims and shortens the first user message into a history-list preview. `undefined` if there is no user message with any content yet. */
function computePreview(messages: ChatMessage[]): string | undefined {
  const firstUser = messages.find((m) => m.role === "user");
  const trimmed = firstUser?.content.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
}

// ---------------------------------------------------------------------------
// Low-level storage helpers
// ---------------------------------------------------------------------------

async function readChatIndex(): Promise<ChatIndexEntry[]> {
  const stored = await chrome.storage.local.get(CHAT_INDEX_KEY);
  const value = stored[CHAT_INDEX_KEY];
  return Array.isArray(value) ? value.filter(isChatIndexEntry) : [];
}

async function writeChatIndex(list: ChatIndexEntry[]): Promise<void> {
  await chrome.storage.local.set({ [CHAT_INDEX_KEY]: list });
}

async function readChatRaw(chatId: string): Promise<ChatSession | undefined> {
  const key = chatStorageKey(chatId);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  return isChatSession(value) ? value : undefined;
}

async function readTabPointer(tabId: number): Promise<TabPointer | undefined> {
  const key = tabPointerKey(tabId);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  return isTabPointer(value) ? value : undefined;
}

/** Removes every `tabchat:*` pointer that targets one of `chatIds` — used when a chat is deleted (explicitly or by the backstop eviction) so a stale pointer can never resurrect it or hand a tab a chat id that no longer resolves to anything. */
async function removeTabPointersFor(chatIds: ReadonlySet<string>): Promise<void> {
  if (chatIds.size === 0) return;
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter((k) => {
    if (!k.startsWith(TAB_POINTER_PREFIX)) return false;
    const v = all[k];
    return isTabPointer(v) && chatIds.has(v.chatId);
  });
  if (stale.length > 0) await chrome.storage.local.remove(stale);
}

/**
 * Backstop eviction (see {@link MAX_RETAINED_CHATS}'s doc comment): drops
 * the oldest chats (by `updatedAt`) only once the retained count exceeds
 * the cap. Not the primary way chats go away — explicit deletion is.
 */
async function evictIfNeeded(): Promise<void> {
  const index = await readChatIndex();
  if (index.length <= MAX_RETAINED_CHATS) return;

  const sorted = [...index].sort((a, b) => a.updatedAt - b.updatedAt);
  const evictCount = sorted.length - MAX_RETAINED_CHATS;
  const toEvict = sorted.slice(0, evictCount);
  const toKeep = sorted.slice(evictCount);

  await chrome.storage.local.remove(toEvict.map((e) => chatStorageKey(e.id)));
  await writeChatIndex(toKeep);
  await removeTabPointersFor(new Set(toEvict.map((e) => e.id)));
}

async function commitSession(session: ChatSession): Promise<void> {
  const key = chatStorageKey(session.id);
  await chrome.storage.local.set({ [key]: session });

  const index = await readChatIndex();
  const nextIndex = index.filter((e) => e.id !== session.id);
  nextIndex.push({
    id: session.id,
    origin: session.origin,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    toolCallCount: session.toolCalls.length,
    preview: computePreview(session.messages),
  });
  await writeChatIndex(nextIndex);

  await evictIfNeeded();
}

// ---------------------------------------------------------------------------
// Migration (decision 13's "real decision, not an accident")
//
// CHOICE: convert, don't discard. The extension is in active use with real
// conversations on disk under the old `session:<tabId>` keyspace. Decision
// 13 explicitly allows discarding as "defensible this early", but the
// alternative here costs little (a one-time storage scan) and there is no
// good reason to delete a user's history just because its key shape
// changed, so every legacy session that has actual message content is
// converted into a first-class chat under a fresh id, and the tab it
// belonged to is pointed at it (best-effort: only useful if that tab id
// still shows the same origin by the time the pointer is read). A legacy
// session with zero messages (created but never used) is dropped rather
// than resurrected as an empty, unrecognisable history entry — there is
// nothing in it worth a slot in the list.
// ---------------------------------------------------------------------------

interface LegacyChatSession {
  tabId: number;
  origin: string;
  messages: ChatMessage[];
  selection?: ProviderSelection;
  toolCalls: ToolCallLogEntry[];
  createdAt: number;
  updatedAt: number;
}

function isLegacyChatSession(v: unknown): v is LegacyChatSession {
  return (
    isRecord(v) &&
    typeof v.tabId === "number" &&
    typeof v.origin === "string" &&
    Array.isArray(v.messages) &&
    v.messages.every(isChatMessageLike) &&
    (v.selection === undefined || isProviderSelectionLike(v.selection)) &&
    Array.isArray(v.toolCalls) &&
    v.toolCalls.every(isToolCallLogEntry) &&
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number"
  );
}

const LEGACY_SESSION_KEY_PREFIX = "session:";
const LEGACY_INDEX_KEY = "session:index";

let migrationPromise: Promise<void> | undefined;

async function runMigration(): Promise<void> {
  const flagStored = await chrome.storage.local.get(MIGRATION_FLAG_KEY);
  if (flagStored[MIGRATION_FLAG_KEY]) return;

  const all = await chrome.storage.local.get(null);
  const legacyKeys = Object.keys(all).filter(
    (k) => k.startsWith(LEGACY_SESSION_KEY_PREFIX) && k !== LEGACY_INDEX_KEY,
  );

  for (const key of legacyKeys) {
    const value = all[key];
    if (!isLegacyChatSession(value) || value.messages.length === 0) continue;

    const chat: ChatSession = {
      id: makeChatId(),
      origin: value.origin,
      messages: value.messages,
      selection: value.selection,
      toolCalls: value.toolCalls,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
    await commitSession(chat);
    await chrome.storage.local.set({
      [tabPointerKey(value.tabId)]: { chatId: chat.id, tabOrigin: value.origin } satisfies TabPointer,
    });
  }

  const keysToRemove = [...legacyKeys, LEGACY_INDEX_KEY].filter((k) => k in all);
  if (keysToRemove.length > 0) await chrome.storage.local.remove(keysToRemove);

  await chrome.storage.local.set({ [MIGRATION_FLAG_KEY]: true });
}

/** Idempotent, safe to call from every entry point below — the flag check makes repeat calls (including from multiple contexts, e.g. the side panel and the options page both opening around the same time) cheap no-ops once migration has actually run. */
async function migrateLegacySessionsOnce(): Promise<void> {
  migrationPromise ??= runMigration();
  return migrationPromise;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** Build a brand-new, empty chat for `origin`. Pure — does not touch storage; pass the result to {@link saveSession} once it has content worth keeping. */
export function createChat(origin: string, selection?: ProviderSelection): ChatSession {
  const now = Date.now();
  return {
    id: makeChatId(),
    origin,
    messages: [],
    selection,
    toolCalls: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Fetch one chat by id — for opening a history entry (decision 13: allowed even against a tab of a different origin; the caller is responsible for presenting that honestly, see src/sidepanel/stores/panel.svelte.ts). `undefined` if it was deleted or never existed. */
export async function getChat(chatId: string): Promise<ChatSession | undefined> {
  await migrateLegacySessionsOnce();
  return readChatRaw(chatId);
}

/**
 * Resolve `tabId`'s CURRENT chat (decision 13: a tab holds a pointer, not
 * ownership): follows the tab's stored pointer if one exists and its
 * `tabOrigin` matches `currentOrigin` (the guard against a recycled tab id
 * — see this module's header comment), and the pointed-at chat still
 * exists. Otherwise returns a fresh, unsaved {@link createChat} result —
 * this does NOT write anything; call {@link saveSession} once the chat has
 * content, and point the tab at it with `setCurrentChatForTab`.
 */
export async function getOrCreateChatForTab(
  tabId: number,
  currentOrigin: string,
): Promise<ChatSession> {
  await migrateLegacySessionsOnce();

  const pointer = await readTabPointer(tabId);
  if (pointer && pointer.tabOrigin === currentOrigin) {
    const chat = await readChatRaw(pointer.chatId);
    if (chat) return chat;
  }
  return createChat(currentOrigin);
}

/** Point `tabId` at `chatId` as its current chat. `tabOrigin` should be the tab's actual current origin (not the chat's own `origin`, which may legitimately differ — decision 13's cross-origin-open case) — it exists purely to detect a recycled tab id on a later {@link getOrCreateChatForTab} call. A small, immediate write (not debounced) — safe to call on every tab switch/chat open. */
export async function setCurrentChatForTab(
  tabId: number,
  chatId: string,
  tabOrigin: string,
): Promise<void> {
  await chrome.storage.local.set({
    [tabPointerKey(tabId)]: { chatId, tabOrigin } satisfies TabPointer,
  });
}

// ---------------------------------------------------------------------------
// Tool-call log
// ---------------------------------------------------------------------------

/** Append a new tool-call log entry (mutates `session.toolCalls`) and return it so the caller can later pass its `id` to {@link completeToolCall}. A `"denied"` call is terminal on append — it never runs, so there's nothing to complete. */
export function logToolCall(
  session: ChatSession,
  entry: Omit<ToolCallLogEntry, "startedAt" | "endedAt">,
): ToolCallLogEntry {
  const full: ToolCallLogEntry = { ...entry, startedAt: Date.now() };
  if (entry.mode === "denied") full.endedAt = full.startedAt;
  session.toolCalls.push(full);
  return full;
}

/** Record the outcome of a previously-logged (`"auto"`/`"approved"`) tool call by its `id`. No-op if `id` isn't found. */
export function completeToolCall(
  session: ChatSession,
  id: string,
  outcome: { result: unknown } | { error: string },
): void {
  const entry = session.toolCalls.find((e) => e.id === id);
  if (!entry) return;
  if ("result" in outcome) entry.result = outcome.result;
  else entry.error = outcome.error;
  entry.endedAt = Date.now();
}

// ---------------------------------------------------------------------------
// Debounced persistence
// ---------------------------------------------------------------------------

interface PendingWrite {
  session: ChatSession;
  timer: ReturnType<typeof setTimeout>;
  maxTimer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingWrite>();

function clearPending(chatId: string): void {
  const entry = pending.get(chatId);
  if (!entry) return;
  clearTimeout(entry.timer);
  clearTimeout(entry.maxTimer);
  pending.delete(chatId);
}

/**
 * Persist `session`, debounced. Stamps `session.updatedAt = Date.now()`
 * before scheduling.
 *
 * By default this only *schedules* a write: it resolves once the timer is
 * (re)armed, not once bytes hit `chrome.storage.local`. A write commits
 * {@link DEBOUNCE_MS} after the last call for this chat, or at latest
 * {@link MAX_WAIT_MS} after the first pending change, whichever comes
 * first — so a continuous stream of changes (token-by-token) still lands
 * periodically instead of never firing the trailing-edge timer.
 *
 * Pass `{immediate: true}` to bypass debouncing and write synchronously —
 * use for a chat's first save, or any point where losing the write to a
 * closed panel would be surprising rather than expected.
 */
export async function saveSession(
  session: ChatSession,
  opts: { immediate?: boolean } = {},
): Promise<void> {
  session.updatedAt = Date.now();

  if (opts.immediate) {
    clearPending(session.id);
    await commitSession(session);
    return;
  }

  const existing = pending.get(session.id);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    void flushSession(session.id);
  }, DEBOUNCE_MS);

  const maxTimer =
    existing?.maxTimer ??
    setTimeout(() => {
      void flushSession(session.id);
    }, MAX_WAIT_MS);

  pending.set(session.id, { session, timer, maxTimer });
}

/** Force any pending debounced write for `chatId` to commit now. Safe to call with nothing pending (resolves immediately). The panel should call this on unload/visibility-change so a debounce window in flight when the panel closes doesn't lose its tail. */
export async function flushSession(chatId: string): Promise<void> {
  const entry = pending.get(chatId);
  if (!entry) return;
  clearPending(chatId);
  await commitSession(entry.session);
}

/** {@link flushSession} for every chat with a pending write — for a single panel-teardown call site that shouldn't need to know which chats have unsaved changes. */
export async function flushAllSessions(): Promise<void> {
  await Promise.all([...pending.keys()].map((chatId) => flushSession(chatId)));
}

// ---------------------------------------------------------------------------
// Delete / clear (decision 13: the explicit, primary way chats go away)
// ---------------------------------------------------------------------------

/** Discard one chat — any pending debounced write, the stored chat, its index entry, and any tab pointer(s) that targeted it. Genuine delete: nothing about the chat (including any page content or tool results it held) remains in storage afterward. */
export async function deleteChat(chatId: string): Promise<void> {
  await migrateLegacySessionsOnce();

  clearPending(chatId);
  await chrome.storage.local.remove(chatStorageKey(chatId));

  const index = await readChatIndex();
  await writeChatIndex(index.filter((e) => e.id !== chatId));

  await removeTabPointersFor(new Set([chatId]));
}

/** Discard every stored chat and every tab's pointer (the options page's "clear all history"). Leaves the migration flag alone — legacy data will already be gone by the time this can run, so there is nothing left to re-migrate either way. */
export async function clearAllChats(): Promise<void> {
  await migrateLegacySessionsOnce();

  for (const chatId of pending.keys()) clearPending(chatId);

  const all = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(all).filter(
    (k) =>
      (k.startsWith(CHAT_KEY_PREFIX) || k.startsWith(TAB_POINTER_PREFIX)) &&
      k !== MIGRATION_FLAG_KEY,
  );
  if (keysToRemove.length > 0) await chrome.storage.local.remove(keysToRemove);
}

/** Every stored chat's lightweight summary (decision 13's global history list), newest first. Reads only `chat:index` — never a full chat's message history — so this stays cheap at any retention size. */
export async function listChatSummaries(): Promise<ChatSummary[]> {
  await migrateLegacySessionsOnce();
  const index = await readChatIndex();
  return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---------------------------------------------------------------------------
// Dangling-provider detection (decision 10) — reuses the registry's
// resolveSelection rather than reimplementing tri-state ok/dangling/none
// detection here.
// ---------------------------------------------------------------------------

/** Resolve a chat's `{providerId, model}` selection the same way the global default resolves (`src/lib/providers/registry.ts`'s `resolveSelection`) — `"ok"`, `"dangling"` (the provider was deleted since it was selected), or `"none"` (nothing selected yet). The panel branches on `status` to prompt for a replacement provider rather than failing to send. */
export async function resolveSessionSelection(
  session: ChatSession,
): Promise<SelectionResolution> {
  return resolveSelection(session.selection);
}

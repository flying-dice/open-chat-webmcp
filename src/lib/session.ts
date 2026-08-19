// Per-tab chat session persistence (decisions/07-session-state-and-persistence.md).
// A pure, UI-free storage module: one `ChatSession` per tab id, holding the
// message history, the selected `{providerId, model}` (decisions/10, same
// shape `src/lib/providers/registry.ts`'s `resolveSelection` already
// resolves for the global default), and the tool-call log the inspector
// (card 11) renders.
//
// This module owns *when to write and what to keep*; it deliberately does
// not own *when a navigation or tab switch happened* — the panel (built on
// top of this) is expected to call `loadSession` on open/tab-switch and
// `applyNavigation` on `chrome.tabs.onUpdated`, per decision 07.
//
// Storage shape (`chrome.storage.local`, unencrypted — decisions/07, 10):
//   - `session:<tabId>`  → one `ChatSession`
//   - `session:index`    → `{tabId, updatedAt}[]`, used for eviction
//     (oldest `updatedAt` dropped first once `MAX_RETAINED_SESSIONS` is
//     exceeded) and for `listSessionSummaries()` without reading every
//     session's full message history.
//
// Writes are debounced per tab (`DEBOUNCE_MS` of inactivity, capped by
// `MAX_WAIT_MS` so a long token stream still lands periodically rather than
// starving the debounce indefinitely) — see `saveSession`. The pending-write
// map lives only in this module's memory, which lives only as long as the
// panel does; `flushSession`/`flushAllSessions` are exposed so the panel can
// force a synchronous write on unload/visibility-change and not lose the
// tail of a streamed message. That wiring is the panel's job, not this
// module's.
//
// Tab ids are recycled by Chrome after a tab closes (decision 07). A stored
// session's `origin` is the guard against silently resuming a stale one:
// `loadSession` discards (and removes from storage) any session whose
// stored origin doesn't match the tab's *current* origin, rather than
// handing back a conversation that belongs to whatever site used to be in
// that tab id.

import type { ChatMessage } from "./provider";
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
 * One entry in a session's tool-call log: name, arguments, result or error,
 * timing, and the approval mode. Created via {@link logToolCall} (denied
 * calls never run — record them directly, no {@link completeToolCall}
 * needed) and finished via {@link completeToolCall}.
 */
export interface ToolCallLogEntry {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  mode: ToolCallMode;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

/** One tab's conversation: history, provider+model selection, and tool-call log (decision 07). */
export interface ChatSession {
  tabId: number;
  /** The tab's origin at the time this session was created/reset — the guard against resuming a stale session under a recycled tab id. */
  origin: string;
  messages: ChatMessage[];
  /** `{providerId, model}` — same shape as the global default (decisions/10). Absent until the user picks one for this tab. */
  selection?: ProviderSelection;
  toolCalls: ToolCallLogEntry[];
  createdAt: number;
  updatedAt: number;
}

/** Lightweight view of a session for a "clear history" list (options page) — no message bodies, so listing every session stays cheap. */
export interface SessionSummary {
  tabId: number;
  origin: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  toolCallCount: number;
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Debounce window: a write is scheduled this long after the *last* change. Short enough that closing the panel soon after a stream ends still lands via the max-wait fallback below, not just this timer. */
const DEBOUNCE_MS = 400;

/** Upper bound on how long a change can sit unwritten during a continuous stream of changes (e.g. token-by-token streaming, which keeps resetting the plain debounce timer). Guarantees a write lands at least this often even under constant activity. */
const MAX_WAIT_MS = 2000;

/** Cap on retained sessions; the oldest (by `updatedAt`) is evicted once this is exceeded (decision 07: "storage grows with use, so sessions need an eviction policy"). */
export const MAX_RETAINED_SESSIONS = 20;

const SESSION_KEY_PREFIX = "session:";
const INDEX_KEY = "session:index";

function sessionStorageKey(tabId: number): string {
  return `${SESSION_KEY_PREFIX}${tabId}`;
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

interface IndexEntry {
  tabId: number;
  updatedAt: number;
}

function isIndexEntry(v: unknown): v is IndexEntry {
  return isRecord(v) && typeof v.tabId === "number" && typeof v.updatedAt === "number";
}

// ---------------------------------------------------------------------------
// Low-level storage helpers
// ---------------------------------------------------------------------------

async function readIndex(): Promise<IndexEntry[]> {
  const stored = await chrome.storage.local.get(INDEX_KEY);
  const value = stored[INDEX_KEY];
  return Array.isArray(value) ? value.filter(isIndexEntry) : [];
}

async function writeIndex(list: IndexEntry[]): Promise<void> {
  await chrome.storage.local.set({ [INDEX_KEY]: list });
}

async function readSessionRaw(tabId: number): Promise<ChatSession | undefined> {
  const key = sessionStorageKey(tabId);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  return isChatSession(value) ? value : undefined;
}

async function removeSessionRaw(tabId: number): Promise<void> {
  await chrome.storage.local.remove(sessionStorageKey(tabId));
  const index = await readIndex();
  await writeIndex(index.filter((e) => e.tabId !== tabId));
}

/** Drop the oldest sessions (by `updatedAt`) once the retained count exceeds {@link MAX_RETAINED_SESSIONS}. */
async function evictIfNeeded(): Promise<void> {
  const index = await readIndex();
  if (index.length <= MAX_RETAINED_SESSIONS) return;

  const sorted = [...index].sort((a, b) => a.updatedAt - b.updatedAt);
  const evictCount = sorted.length - MAX_RETAINED_SESSIONS;
  const toEvict = sorted.slice(0, evictCount);
  const toKeep = sorted.slice(evictCount);

  await chrome.storage.local.remove(toEvict.map((e) => sessionStorageKey(e.tabId)));
  await writeIndex(toKeep);
}

async function commitSession(session: ChatSession): Promise<void> {
  const key = sessionStorageKey(session.tabId);
  await chrome.storage.local.set({ [key]: session });

  const index = await readIndex();
  const nextIndex = index.filter((e) => e.tabId !== session.tabId);
  nextIndex.push({ tabId: session.tabId, updatedAt: session.updatedAt });
  await writeIndex(nextIndex);

  await evictIfNeeded();
}

// ---------------------------------------------------------------------------
// Construction / rehydration
// ---------------------------------------------------------------------------

/** Build a brand-new, empty session for `tabId`/`origin`. Pure — does not touch storage; pass the result to {@link saveSession} to persist it. */
export function createSession(
  tabId: number,
  origin: string,
  selection?: ProviderSelection,
): ChatSession {
  const now = Date.now();
  return {
    tabId,
    origin,
    messages: [],
    selection,
    toolCalls: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Rehydrate the session stored for `tabId`, for the panel to call on open
 * and on active-tab switch (decision 07: "rehydrated when the panel opens
 * or the active tab changes... switching tabs swaps the visible session;
 * it never merges histories" — that guarantee holds simply because this
 * always returns/creates a session for exactly one `tabId`, never combining
 * two).
 *
 * If a session is stored but its `origin` doesn't match `currentOrigin`,
 * it's discarded (removed from storage) rather than returned — this is the
 * recycled-tab-id guard decision 07 calls out: Chrome reuses tab ids after
 * a tab closes, so a stored session under that id may belong to a
 * completely different site that used to live there.
 */
export async function loadSession(
  tabId: number,
  currentOrigin: string,
): Promise<ChatSession | undefined> {
  const session = await readSessionRaw(tabId);
  if (!session) return undefined;
  if (session.origin !== currentOrigin) {
    await clearSession(tabId);
    return undefined;
  }
  return session;
}

/** {@link loadSession}, falling back to a fresh {@link createSession} result when there is nothing to rehydrate (or what was stored didn't match `currentOrigin`). Does not persist the fresh session — call {@link saveSession} once it has content worth keeping. */
export async function getOrCreateSession(
  tabId: number,
  currentOrigin: string,
  defaultSelection?: ProviderSelection,
): Promise<ChatSession> {
  const existing = await loadSession(tabId, currentOrigin);
  return existing ?? createSession(tabId, currentOrigin, defaultSelection);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Build the fresh session a cross-origin navigation requires (decision 07:
 * "the old conversation refers to tools and page state that no longer
 * exist"). Keeps `tabId`; resets `origin`, `messages`, and `toolCalls`. The
 * provider/model `selection` is a user preference rather than page state,
 * so it carries over by default — pass `keepSelection: false` to also
 * clear it. Pure — call {@link saveSession} to persist the result.
 */
export function resetSession(
  session: ChatSession,
  newOrigin: string,
  opts: { keepSelection?: boolean } = {},
): ChatSession {
  const keepSelection = opts.keepSelection ?? true;
  const now = Date.now();
  return {
    tabId: session.tabId,
    origin: newOrigin,
    messages: [],
    selection: keepSelection ? session.selection : undefined,
    toolCalls: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The navigation decision from decision 07: same-origin keeps `session`
 * as-is (the panel separately refreshes the tool list — that's the
 * background/service-worker's tool registry, not this module's concern);
 * cross-origin returns a fresh session via {@link resetSession}. Call from
 * the panel's `chrome.tabs.onUpdated` handler; persist the result with
 * {@link saveSession}.
 */
export function applyNavigation(session: ChatSession, newOrigin: string): ChatSession {
  return session.origin === newOrigin ? session : resetSession(session, newOrigin);
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

const pending = new Map<number, PendingWrite>();

function clearPending(tabId: number): void {
  const entry = pending.get(tabId);
  if (!entry) return;
  clearTimeout(entry.timer);
  clearTimeout(entry.maxTimer);
  pending.delete(tabId);
}

/**
 * Persist `session`, debounced (decision 07: "written on every streamed
 * message... a naive write-per-token would hammer storage"). Stamps
 * `session.updatedAt = Date.now()` before scheduling.
 *
 * By default this only *schedules* a write: it resolves once the timer is
 * (re)armed, not once bytes hit `chrome.storage.local`. A write commits
 * {@link DEBOUNCE_MS} after the last call for this `tabId`, or at latest
 * {@link MAX_WAIT_MS} after the first pending change, whichever comes
 * first — so a continuous stream of changes (token-by-token) still lands
 * periodically instead of never firing the trailing-edge timer.
 *
 * Pass `{immediate: true}` to bypass debouncing and write synchronously —
 * use for a session's first save, or any point where losing the write to a
 * closed panel would be surprising rather than expected.
 */
export async function saveSession(
  session: ChatSession,
  opts: { immediate?: boolean } = {},
): Promise<void> {
  session.updatedAt = Date.now();

  if (opts.immediate) {
    clearPending(session.tabId);
    await commitSession(session);
    return;
  }

  const existing = pending.get(session.tabId);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    void flushSession(session.tabId);
  }, DEBOUNCE_MS);

  const maxTimer =
    existing?.maxTimer ??
    setTimeout(() => {
      void flushSession(session.tabId);
    }, MAX_WAIT_MS);

  pending.set(session.tabId, { session, timer, maxTimer });
}

/** Force any pending debounced write for `tabId` to commit now. Safe to call with nothing pending (resolves immediately). The panel should call this on unload/visibility-change so a debounce window in flight when the panel closes doesn't lose its tail. */
export async function flushSession(tabId: number): Promise<void> {
  const entry = pending.get(tabId);
  if (!entry) return;
  clearPending(tabId);
  await commitSession(entry.session);
}

/** {@link flushSession} for every tab with a pending write — for a single panel-teardown call site that shouldn't need to know which tabs have unsaved changes. */
export async function flushAllSessions(): Promise<void> {
  await Promise.all([...pending.keys()].map((tabId) => flushSession(tabId)));
}

// ---------------------------------------------------------------------------
// Clear history
// ---------------------------------------------------------------------------

/** Discard one tab's session — any pending debounced write and the stored copy alike. This is a genuine delete: nothing about the cleared session (including any page content or tool results it held) remains in storage afterward. */
export async function clearSession(tabId: number): Promise<void> {
  clearPending(tabId);
  await removeSessionRaw(tabId);
}

/** Discard every stored session (decision 07's "clear-all in options"). */
export async function clearAllSessions(): Promise<void> {
  for (const tabId of pending.keys()) clearPending(tabId);

  const index = await readIndex();
  const keys = index.map((e) => sessionStorageKey(e.tabId));
  await chrome.storage.local.remove([...keys, INDEX_KEY]);
}

/** Lightweight listing of every stored session (no message bodies) for a "clear history" UI — options page's per-session list plus the clear-all button. Newest first. */
export async function listSessionSummaries(): Promise<SessionSummary[]> {
  const index = await readIndex();
  const sessions = await Promise.all(index.map((e) => readSessionRaw(e.tabId)));
  return sessions
    .filter((s): s is ChatSession => s !== undefined)
    .map((s) => ({
      tabId: s.tabId,
      origin: s.origin,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
      toolCallCount: s.toolCalls.length,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---------------------------------------------------------------------------
// Dangling-provider detection (decision 10) — reuses the registry's
// resolveSelection rather than reimplementing tri-state ok/dangling/none
// detection here.
// ---------------------------------------------------------------------------

/** Resolve a session's `{providerId, model}` selection the same way the global default resolves (`src/lib/providers/registry.ts`'s `resolveSelection`) — `"ok"`, `"dangling"` (the provider was deleted since it was selected), or `"none"` (nothing selected yet). The panel branches on `status` to prompt for a replacement provider rather than failing to send. */
export async function resolveSessionSelection(
  session: ChatSession,
): Promise<SelectionResolution> {
  return resolveSelection(session.selection);
}

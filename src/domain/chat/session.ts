// The chat aggregate (decisions/13-global-tab-aware-chat-history.md, which
// REVISES decisions/07-session-state-and-persistence.md's session identity,
// cross-origin reset and eviction). Everything here is a rule about a
// CONVERSATION; where a conversation is kept is `ChatStore`'s business (see
// ./store.ts) and how it is kept is `src/infra/chrome-storage`'s.
//
// The unit of identity is a CHAT, not a tab: each `ChatSession` has its own
// `id`, is listed globally, and records the origin it was started against. A
// tab no longer OWNS a session — it holds a soft POINTER to whichever chat
// it currently shows (`ChatStore.setCurrentChatForTab`). This module does
// NOT own *when* a navigation or tab switch happened — but as of card 77 the
// decision that follows from one (retire the current chat, start a fresh one)
// IS domain business and lives next door in ./service.ts, no longer in a
// Svelte store.

import type { ProviderSelection } from "../providers";
import type { ToolOrigin } from "../tools";
import type { ToolCallMode, TranscriptEntry } from "./message";

// Re-exported for continuity: `ToolCallMode` is the transcript vocabulary
// (./message.ts) AND the tool-call log's, and every existing importer takes
// it from this context's barrel either way.
export type { ToolCallMode };

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
  origin?: ToolOrigin | undefined;
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
  /**
   * The transcript, in the shape it is actually persisted in
   * (./message.ts). Before card 77 this was typed `ChatMessage[]` — the
   * PROVIDER wire shape — while every entry stored in it was really a
   * `PanelMessage` from a UI store, smuggled in by structural subtyping and
   * read back out with a cast. The aggregate declared less than it stored;
   * now it declares exactly what it stores, and {@link toModelMessage} is
   * the one place a stored entry becomes a provider message.
   */
  messages: TranscriptEntry[];
  /** `{providerId, model}` — same shape as the global default (decisions/10). Absent until the user picks one. */
  selection?: ProviderSelection | undefined;
  /**
   * Whether {@link ChatSession.selection} was set by a DELIBERATE user action
   * rather than silently seeded from the stored global default (card 35).
   * Both round-trip as the identical `{providerId, model}` shape, so nothing
   * else can tell them apart, and the composer has to: an implicitly-seeded
   * selection asks for a one-click confirmation before the first message.
   *
   * Card 77 promoted this to a declared field. It was previously written onto
   * the session by the panel store through a
   * `ChatSession & {selectionExplicit?: boolean}` cast — the same
   * "store more than the type admits" trick `messages` used, on the same
   * object, for the same reason (the type lived where the writer could not
   * change it). Absent reads as "not explicit", the safer reading when the
   * data genuinely cannot say (an already-blocked composer once, rather than
   * silently trusting an old implicit default forever).
   */
  selectionExplicit?: boolean;
  toolCalls: ToolCallLogEntry[];
  createdAt: number;
  updatedAt: number;
  /**
   * An explicit, user-set name (decisions/24-explicit-chat-titles.md).
   * Absent means "derived" — ./title.ts takes over exactly as it always has.
   * Set via `ChatService.renameCurrent` (./service.ts); an
   * empty/whitespace-only rename UNSETS this field rather than storing `""`,
   * so clearing the name reverts to the derived title.
   */
  title?: string | undefined;
}

/** Lightweight view of a chat for a history list (the panel's History view and the options page's "clear history" section) — no message bodies, so listing every chat stays cheap even at a high retention cap. */
export interface ChatSummary {
  id: string;
  origin: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  toolCallCount: number;
  /** The first user message's content, trimmed and truncated — enough to recognise the chat in a list. `undefined` if the chat has no user message yet (an empty or assistant-only chat). */
  preview?: string | undefined;
  /** Explicit user-set name, mirrored from `ChatSession.title` (decisions/24) — see that field's doc comment. `undefined` means derived. */
  title?: string | undefined;
}

/**
 * Backstop cap on retained chats (decision 13: "eviction by count is
 * replaced with explicit deletion plus a much higher cap"). Deletion is the
 * intended, user-visible way chats go away; this cap only exists so storage
 * stays bounded for a user who never deletes anything. 20x the old per-tab
 * cap (which was itself sized for a handful of tabs, not a lifetime of
 * history), so an ordinary user should never reach it.
 *
 * A retention rule, not a storage detail — which is why it lives here and
 * the adapter that enforces it (src/infra/chrome-storage/chat-store.ts)
 * reads it from the domain rather than owning its own number.
 */
export const MAX_RETAINED_CHATS = 400;

/** Longest preview/derived-title text a chat summary carries — keeps a chat's index footprint bounded regardless of how long its first message is. */
export const MAX_CHAT_PREVIEW_LENGTH = 120;

// TODO: clean-code - 0.4 - DRY: byte-for-byte identical crypto.randomUUID/fallback id-generation pattern as service.ts's makeMessageId, differing only in the fallback string prefix.
function makeChatId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Build a brand-new, empty chat for `origin`. Pure — touches no storage; pass the result to `ChatStore.save` once it has content worth keeping. */
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

// TODO: clean-code - 0.35 - DRY: "truncate text to N chars, append an ellipsis" is hand-rolled here (inline), and separately in turn.ts's truncate and title.ts's truncate, with three slightly different ellipsis markers, instead of one shared helper.
/** Trims and shortens the first user message into a history-list preview. `undefined` if there is no user message with any content yet. */
export function chatPreview(messages: readonly TranscriptEntry[]): string | undefined {
  const firstUser = messages.find((m) => m.role === "user");
  const trimmed = firstUser?.content.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_CHAT_PREVIEW_LENGTH
    ? `${trimmed.slice(0, MAX_CHAT_PREVIEW_LENGTH)}…`
    : trimmed;
}

/** The `ChatSummary` view of a chat — what a history list shows, derived here so the index an adapter writes and the list a caller reads can never disagree. */
export function summarizeChat(session: ChatSession): ChatSummary {
  return {
    id: session.id,
    origin: session.origin,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    toolCallCount: session.toolCalls.length,
    preview: chatPreview(session.messages),
    title: session.title,
  };
}

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

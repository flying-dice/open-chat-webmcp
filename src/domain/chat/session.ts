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
// NOT own *when* a navigation or tab switch happened, or the decision to
// retire the current chat and start a fresh one on cross-origin navigation:
// that policy lives with the in-memory session owner, today
// src/sidepanel/stores/panel.svelte.ts.

import type { ChatMessage } from "../providers";
import type { ProviderSelection } from "../providers";
import type { ToolOrigin } from "../tools";

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
  /**
   * An explicit, user-set name (decisions/24-explicit-chat-titles.md).
   * Absent means "derived" — `src/sidepanel/lib/chatTitle.ts` takes over
   * exactly as it always has. Set via `renameActiveChat`
   * (src/sidepanel/stores/panel.svelte.ts); an empty/whitespace-only rename
   * UNSETS this field rather than storing `""`, so clearing the name reverts
   * to the derived title.
   */
  title?: string;
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
  preview?: string;
  /** Explicit user-set name, mirrored from `ChatSession.title` (decisions/24) — see that field's doc comment. `undefined` means derived. */
  title?: string;
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

/** Trims and shortens the first user message into a history-list preview. `undefined` if there is no user message with any content yet. */
export function chatPreview(messages: readonly ChatMessage[]): string | undefined {
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

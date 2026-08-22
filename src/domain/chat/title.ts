// What a conversation is CALLED (decisions/24-explicit-chat-titles.md).
//
// Card 77 moved this out of src/sidepanel/lib/chatTitle.ts, unchanged apart
// from taking its message type from this context (`TranscriptEntry`) instead
// of importing the panel store's `PanelMessage`. It was already pure — the
// reason it belongs here is not that it needed cleaning, it is that "what a
// chat is called" is a rule about a conversation, and the header, the
// overflow menu and the History rows must not be able to disagree about it.
//
// A chat may carry an explicit, user-set `title` — set by renaming it from
// the header. When present it always wins. When absent the title is a pure
// derivation from what is already persisted: `ChatSummary.preview` holds the
// first user message trimmed to `MAX_CHAT_PREVIEW_LENGTH`, and a live
// session's messages hold the same text — no schema beyond the optional
// field, no migration, and no extra provider round trip to generate one.

import type { TranscriptEntry } from "./message";
import type { ChatSummary } from "./session";

/** Shown when a chat has nothing to derive a title from yet. */
export const UNTITLED_CHAT = "New chat";

/**
 * How much of the first message a title shows. Short enough that it never
 * crowds out the header's icon buttons at ~320px, where there is room for
 * roughly this much before the ellipsis would do all the work.
 */
export const TITLE_MAX_LENGTH = 48;

/** Collapse newlines and runs of whitespace — a pasted multi-line prompt still has to render as one header line. */
function firstLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/**
 * Title for the chat currently loaded in the panel. `explicitTitle` — the
 * live session's own `title` — wins when set; otherwise derived from the
 * first user message.
 */
export function titleFromMessages(
  messages: readonly TranscriptEntry[],
  explicitTitle?: string,
): string {
  if (explicitTitle) return truncate(firstLine(explicitTitle), TITLE_MAX_LENGTH);
  const firstUser = messages.find((m) => m.role === "user");
  const text = firstUser ? firstLine(firstUser.content) : "";
  return text ? truncate(text, TITLE_MAX_LENGTH) : UNTITLED_CHAT;
}

/**
 * Title for a chat in a LIST (the overflow menu's recent chats and the
 * History rows). An explicit `summary.title` wins; otherwise the preview,
 * then the origin rather than "New chat" — in a list of many chats, knowing
 * which site one belongs to is more use than knowing it was never named.
 */
export function titleFromSummary(summary: ChatSummary, max = TITLE_MAX_LENGTH): string {
  const title = summary.title ? firstLine(summary.title) : "";
  if (title) return truncate(title, max);
  const preview = summary.preview ? firstLine(summary.preview) : "";
  if (preview) return truncate(preview, max);
  return summary.origin || UNTITLED_CHAT;
}

/**
 * Normalise a user-typed rename into what gets STORED: whitespace collapsed,
 * trimmed, and capped at the same `MAX_CHAT_PREVIEW_LENGTH` a derived title
 * already obeys (so a renamed chat's storage footprint stays bounded the same
 * way an unrenamed one's is). `undefined` for an empty result — clearing the
 * name UNSETS `ChatSession.title` and reverts to the derived title, rather
 * than storing `""` (decisions/24 §4).
 */
export function normalizeChatTitle(title: string, maxStored: number): string | undefined {
  const collapsed = title.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  return collapsed.length > maxStored ? collapsed.slice(0, maxStored) : collapsed;
}

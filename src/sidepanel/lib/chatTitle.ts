/**
 * Conversation titles for the panel header and the overflow menu's recent
 * chats list.
 *
 * Chats have no stored title. `ChatSummary.preview` (src/lib/session.ts)
 * already holds the first user message trimmed to 120 chars, and the live
 * session's messages hold the same text, so a title is a pure derivation
 * from what we already persist — no schema change, no migration, and no
 * extra provider round-trip to generate one.
 *
 * Both call sites go through here so the header and the menu can never
 * disagree about what a chat is called.
 */

import type { ChatSummary } from "../../lib/session";
import type { PanelMessage } from "../stores/panel.svelte";

/** Shown when a chat has nothing to derive a title from yet. */
export const UNTITLED_CHAT = "New chat";

/**
 * How much of the first message the header shows. Short enough that the
 * title never crowds out the header's icon buttons at ~320px, where there
 * is room for roughly this much before the ellipsis would do all the work.
 */
const TITLE_MAX = 48;

/** Collapse newlines and runs of whitespace — a pasted multi-line prompt still has to render as one header line. */
function firstLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** Title for the chat currently loaded in the panel, from its live messages. */
export function titleFromMessages(messages: readonly PanelMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const text = firstUser ? firstLine(firstUser.content) : "";
  return text ? truncate(text, TITLE_MAX) : UNTITLED_CHAT;
}

/**
 * Title for a chat in a list. Falls back to the origin rather than
 * "New chat" — in a list of many chats, knowing which site one belongs to
 * is more use than knowing it was never named.
 */
export function titleFromSummary(summary: ChatSummary, max = TITLE_MAX): string {
  const preview = summary.preview ? firstLine(summary.preview) : "";
  if (preview) return truncate(preview, max);
  return summary.origin || UNTITLED_CHAT;
}

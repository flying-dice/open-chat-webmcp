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
import { collapseWhitespace, truncateWithEllipsis } from "./text";

// UNTITLED_CHAT REMOVED (card 102, decisions/37-i18n-paraglide.md):
// decisions/34 keeps copy out of the domain layer, and "New chat" was the
// one hardcoded English string left in this file. `titleFromMessages`/
// `titleFromSummary` below now take the fallback as a required `untitled`
// parameter instead — the same shape `createChatService` already takes
// `originLabel` in — so every call site supplies its own (localized) text
// rather than this module inventing English. All three call sites
// (src/sidepanel/App.svelte, HistoryListItem.svelte, OverflowMenu.svelte)
// pass `m.chatTitle_untitled()`.

/**
 * How much of the first message a title shows. Short enough that it never
 * crowds out the header's icon buttons at ~320px, where there is room for
 * roughly this much before the ellipsis would do all the work.
 */
export const TITLE_MAX_LENGTH = 48;

// Card 113: "collapse a pasted multi-line prompt into one header line" and
// "cut to N characters with an ellipsis" are both ./text.ts now — this file
// had its own copy of each, and `normalizeChatTitle` below had a SECOND copy
// of the collapse.

/**
 * Title for the chat currently loaded in the panel. `explicitTitle` — the
 * live session's own `title` — wins when set; otherwise derived from the
 * first user message. `untitled` is shown when there is nothing to derive a
 * title from yet (card 102: the caller's localized fallback, e.g.
 * `m.chatTitle_untitled()` — this module invents no English of its own).
 */
export function titleFromMessages(
  messages: readonly TranscriptEntry[],
  untitled: string,
  explicitTitle?: string,
): string {
  if (explicitTitle)
    return truncateWithEllipsis(collapseWhitespace(explicitTitle), TITLE_MAX_LENGTH);
  const firstUser = messages.find((m) => m.role === "user");
  const text = firstUser ? collapseWhitespace(firstUser.content) : "";
  return text ? truncateWithEllipsis(text, TITLE_MAX_LENGTH) : untitled;
}

/**
 * Title for a chat in a LIST (the overflow menu's recent chats and the
 * History rows). An explicit `summary.title` wins; otherwise the preview,
 * then the origin rather than `untitled` — in a list of many chats, knowing
 * which site one belongs to is more use than knowing it was never named.
 * `untitled` is the caller's localized fallback for the one case none of
 * those exist (card 102, mirrors {@link titleFromMessages}).
 */
export function titleFromSummary(
  summary: ChatSummary,
  untitled: string,
  max = TITLE_MAX_LENGTH,
): string {
  const title = summary.title ? collapseWhitespace(summary.title) : "";
  if (title) return truncateWithEllipsis(title, max);
  const preview = summary.preview ? collapseWhitespace(summary.preview) : "";
  if (preview) return truncateWithEllipsis(preview, max);
  return summary.origin || untitled;
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
  const collapsed = collapseWhitespace(title);
  if (!collapsed) return undefined;
  return collapsed.length > maxStored ? collapsed.slice(0, maxStored) : collapsed;
}

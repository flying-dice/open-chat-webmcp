// Filtering the History list (card 116) — pure, and this file IS the model
// for what "matches" means: a case- and diacritic-insensitive substring test
// against every field a `ChatSummary` carries that a user would recognise a
// past chat by — title, origin, and its message preview. Never a chat's full
// body: `ChatSummary` doesn't hold one (see ./session.ts's doc comment on
// `summarizeChat` — the whole point of the summary is that listing every
// chat stays cheap without loading messages), so there was never a decision
// to make about searching it.
//
// JUDGMENT CALL, journalled per the card's instruction: diacritic-insensitive
// because a history list mixes chat titles and previews in whatever language
// they were typed in, and a user typing "cafe" should still find a chat
// titled "café" — the same spirit as ./title.ts's `collapseWhitespace`
// smoothing over incidental formatting rather than making the user match it
// exactly. Achieved with `String.prototype.normalize("NFD")` (splits a
// pre-composed accented character into its base letter plus a combining
// mark) followed by stripping the combining-mark Unicode block
// (U+0300-U+036F) — a native, locale-independent string operation, not a
// collation library, so it stays exactly as pure as the rest of this
// context.
//
// NO DEBOUNCE. Journalled per the card's instruction, not left silent: this
// filters an in-memory array the caller already has (a history list tops out
// at `MAX_RETAINED_CHATS` = 400 short summaries, no message bodies), so the
// cost of running it on every keystroke is a handful of substring checks —
// not a network call, not a storage read. There is nothing here debouncing
// would protect against; adding one would be defending against a cost that
// doesn't exist.
//
// Pure: no chrome.*, no fetch, no DOM, no Svelte, no locale.

import type { ChatSummary } from "./session";

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Case- and diacritic-insensitive key for matching one string against another. */
function foldForMatch(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

function matchesQuery(summary: ChatSummary, needle: string): boolean {
  if (summary.title !== undefined && foldForMatch(summary.title).includes(needle)) return true;
  if (foldForMatch(summary.origin).includes(needle)) return true;
  return summary.preview !== undefined && foldForMatch(summary.preview).includes(needle);
}

/**
 * `summaries` narrowed to those whose title, origin, or preview contains
 * `query` (case/diacritic-insensitive substring match). An empty or
 * whitespace-only `query` returns every summary, in the same order — a
 * caller showing "no filter applied" doesn't need a special case of its own.
 */
export function filterChatSummaries(
  summaries: readonly ChatSummary[],
  query: string,
): ChatSummary[] {
  const needle = foldForMatch(query.trim());
  if (!needle) return [...summaries];
  return summaries.filter((summary) => matchesQuery(summary, needle));
}

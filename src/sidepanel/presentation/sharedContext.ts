// WORDS for what the user shared from a page (card 119,
// decisions/40-page-context-access.md) — the code-to-copy half of the split
// decisions/34 and decisions/37 establish, and the same shape
// ./connectionStatus.ts and ./toolOrigin.ts already use for cross-component
// wording.
//
// TWO VOCABULARIES LAND HERE, both of them CODES the domain hands over with
// no prose attached:
//
//   `SharedContextMarker` — persisted on a user turn (src/domain/chat), so
//   that a transcript recorded in English and reopened in Japanese reads as
//   Japanese. This is decisions/38's mechanism applied to the one new stored
//   vocabulary this card introduces; card 114 converts the OLDER stored prose
//   (assistant notes, tool statuses) to the same discipline, and when it lands
//   this function is the shape its renderer should take rather than something
//   for it to unpick.
//
//   `PageContextError` — a failed pull (card 118). The two kinds are NOT
//   interchangeable and the copy is where that shows: `Restricted` is
//   TERMINAL (Chrome will never allow a content script into a `chrome://`
//   page, so the message states the fact and offers nothing), while
//   `Unreachable` is a moment ("just now") the user can act on by sending
//   again. `Unexpected` shares `Unreachable`'s wording deliberately: from the
//   user's chair a relay that answered nonsense and a relay that did not
//   answer are the same event, and inventing a third sentence would be
//   telling them about our internals rather than about their page.

import type { PageContextError, SharedContextMarker } from "../../domain/chat";
import { m } from "../../paraglide/messages.js";

/**
 * How many characters of a selection the chip previews. Long enough that a
 * sentence is recognisable at a glance, short enough that the chip stays one
 * or two lines in a 320px panel — the chip is a receipt for what will be sent,
 * not a reader for it.
 */
const EXCERPT_MAX_CHARS = 120;

/**
 * A one-line preview of shared text: whitespace collapsed (a selection across
 * a paragraph break arrives with the newlines in it) and cut to
 * {@link EXCERPT_MAX_CHARS} with an ellipsis.
 *
 * Cut by CODE POINT, not by UTF-16 unit, so an emoji or an astral-plane
 * character at the boundary is never split into a replacement glyph — the
 * excerpt is page-authored text and has no obligation to be plain ASCII.
 */
export function selectionExcerpt(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const points = [...collapsed];
  if (points.length <= EXCERPT_MAX_CHARS) return collapsed;
  return `${points.slice(0, EXCERPT_MAX_CHARS).join("")}…`;
}

/** What a persisted context marker says in the reader's own language — e.g. "Page content shared · shortened to fit". */
export function sharedContextLabel(marker: SharedContextMarker): string {
  const label =
    marker.kind === "page-selection"
      ? m.sharedContext_selectionLabel()
      : m.sharedContext_pageContentLabel();
  return marker.truncated ? `${label} · ${m.sharedContext_shortened()}` : label;
}

/** What to tell the user when the page's text could not be pulled for a turn they asked to include it in. */
export function pageContextFailureMessage(error: PageContextError): string {
  return error.kind === "Restricted"
    ? m.pageContext_contentRestrictedNotice()
    : m.pageContext_contentUnavailableNotice();
}

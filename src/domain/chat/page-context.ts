// What the user has explicitly shared FROM the page, and the port that goes
// and gets it (card 118, decisions/40-page-context-access.md).
//
// WHY THIS LIVES IN `chat` AND NOT IN `tools`. The `tools` context models
// what a page OFFERS and what the model may DO to it — a tool descriptor, a
// call, an approval. Nothing here is any of that: a selection or a page
// extract is text a human decided to put into a conversation, on one turn,
// the same way the text they typed is. It is conversation INPUT, so it is the
// `chat` context's, and decisions/40 says as much ("a PageContext value …
// carried on the turn options"). The transport happens to be the same
// relay/worker channel a tool call uses, but transport is an adapter concern
// (src/infra/chrome-runtime) and never decides ownership.
//
// NAMING. `PageContext` was already taken in ./ports.ts, where it means
// something genuinely different: the page a turn is being RUN AGAINST
// (`{tabId, title, origin}` — which tab's tools this turn may call). This
// file's value is a SNAPSHOT of content pulled out of that page at one user
// gesture, so it is `PageContextSnapshot` and the two never have to be told
// apart by context. Renaming the older one was weighed and rejected: it is
// read by ./turn.ts and by the side panel, both of which other cards in this
// batch are editing.
//
// UNTRUSTED. Everything on a snapshot is page-authored text. decisions/40
// puts it under decisions/17's fencing rule — a turn fences it exactly like a
// tool result and never interpolates it as instructions. This file models it
// as plain data and takes no view on how it is rendered; that is card 120's.
//
// Pure TypeScript — no `chrome.*`, no DOM. The DOM walk that produces a
// snapshot is src/infra/dom/page-extraction.ts; the message round trip that
// carries one is src/infra/chrome-runtime/page-context-source.ts.

import type { Result } from "../result";

/**
 * Which of the two pulls decisions/40 defines produced a snapshot.
 *
 * - `selection` — the user's current selection in the tab, offered as the
 *   composer chip. Cheap, and pulled on the two gestures decisions/40 names
 *   (panel focus and send), never streamed.
 * - `extract` — a readability-lite text extraction of the whole page, taken
 *   only when the user asks for it via the per-chat "Share page" affordance.
 */
export type PageContextMode = "selection" | "extract";

/**
 * Text the user has shared from a page, plus the page identity at the moment
 * it was taken.
 *
 * A snapshot is a VALUE, not a live view: `url`/`title` are recorded here
 * precisely because the tab can navigate between the pull and the send, and a
 * turn must report the page the text actually came from rather than whatever
 * the tab shows by the time it is read.
 */
export interface PageContextSnapshot {
  readonly mode: PageContextMode;

  /**
   * The shared text, whitespace-collapsed.
   *
   * EMPTY IS A REAL, SUCCESSFUL ANSWER, and the common one for `selection`:
   * a collapsed caret or no selection at all is "there is nothing to offer",
   * not a failure. A surface offers the chip only when this is non-empty
   * (card 119); it must never report an error for it.
   */
  readonly text: string;

  /** The page's URL at the moment of the pull. */
  readonly url: string;

  /** The page's `document.title` at the moment of the pull; may be empty. */
  readonly title: string;

  /**
   * True when {@link PageContextSnapshot.text} stops at the extraction cap
   * rather than at the end of the content. decisions/40 requires this to be
   * VISIBLE — a truncation note on the chip and in the fenced block — so a
   * user is never told the model read a whole page it only read the top of.
   */
  readonly truncated: boolean;

  /**
   * UTF-8 byte length of `text`. The cap is measured in bytes, so this is the
   * number the cap is compared against — and the one a surface shows next to
   * a truncation note.
   */
  readonly bytes: number;
}

/**
 * Why a pull could not produce a snapshot, in the domain's own words.
 *
 * Shaped like {@link ../storage!StorageError}'s vocabulary and for the same
 * reason: an adapter maps the platform's own failure (a
 * `chrome.runtime.lastError` string, a timeout, an unexpected response shape)
 * into one of these and keeps the original on `cause`. Nothing in
 * `src/domain/*` sees the messaging layer's error text, and — per
 * decisions/34 and decisions/37 — nothing here is user-visible copy: a
 * surface maps the `kind` to a localized message.
 *
 * - `Restricted` — there is no content relay in that tab AT ALL, and never
 *   will be: `chrome://`, `chrome-extension://`, the Chrome Web Store, the
 *   built-in PDF viewer. decisions/40 says restricted pages behave as today,
 *   which is what this kind lets a surface say. It is the same authoritative
 *   claim `RuntimeGetToolsResponse.restricted` carries (card 31).
 * - `Unreachable` — a relay may well exist and simply did not answer in time,
 *   or the send failed for some other reason. Retrying can work; this is NOT
 *   a claim about the page.
 * - `Unexpected` — the relay answered with something that is not a page
 *   context response. Always carries its `cause`.
 */
export type PageContextErrorKind = "Restricted" | "Unreachable" | "Unexpected";

/** The one error a {@link PageContextSource} reports. `message` is for a developer reading a log; a surface builds its prose from {@link PageContextError.kind}. */
export class PageContextError extends Error {
  readonly kind: PageContextErrorKind;

  constructor(kind: PageContextErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PageContextError";
    this.kind = kind;
  }
}

/**
 * The DRIVEN PORT: go and get what the user chose to share, from one tab, now.
 *
 * PULL-ONLY BY CONSTRUCTION (decisions/40). There is no subscribe, no
 * `onSelectionChanged`, no snapshot pushed from the page — the only way a
 * snapshot comes into existence is a caller invoking this, which a surface
 * only ever does on an explicit user gesture. A port that could stream would
 * make the privacy posture a matter of caller discipline; this one makes it a
 * matter of what the interface can express.
 *
 * Never throws: an unreachable relay and a restricted page are EXPECTED
 * outcomes of asking a browser tab for its content, so they arrive as values
 * (decisions/34).
 */
export interface PageContextSource {
  pull(
    tabId: number,
    mode: PageContextMode,
  ): Promise<Result<PageContextSnapshot, PageContextError>>;
}

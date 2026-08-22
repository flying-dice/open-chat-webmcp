// The two text-shaping rules this bounded context applies to user- and
// tool-authored prose before it is stored or shown (card 113).
//
// Both were hand-rolled at three sites each, with just enough drift between
// the copies to make "what does this repo do with over-long text?" a question
// you had to answer by reading all three: `chatPreview` (./session.ts) sliced
// without trimming the cut edge, `truncate` (./title.ts) trimmed it, and
// `truncate` (./turn.ts) neither trimmed nor used the same ellipsis. The
// ELLIPSIS genuinely differs by purpose — a preview trails off with "…", a
// clipped tool result has to SAY it was clipped — so that is a parameter; the
// slicing and the trimmed cut edge are the same everywhere and live here.
//
// Pure string functions over plain data: no storage, no Svelte, no locale.
// (The ellipsis passed in by ./turn.ts is developer-facing plumbing text, not
// UI copy — see that call site.)

/** Collapse every run of whitespace, newlines included, into single spaces and trim — a pasted multi-line prompt still has to render as one line in a header or a list row. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * `text` cut to at most `max` characters with `ellipsis` appended, or `text`
 * unchanged when it already fits.
 *
 * The cut edge is trimmed before the ellipsis is appended, so a slice that
 * lands mid-space never renders as "word … " with a gap in front of the dots.
 * Note the result can exceed `max` by the ellipsis's own length: `max` bounds
 * how much of the ORIGINAL text is kept, which is what every caller here is
 * actually budgeting for (a stored preview's footprint, a header's width, a
 * tool result's transcript cost).
 */
export function truncateWithEllipsis(text: string, max: number, ellipsis = "…"): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}${ellipsis}` : text;
}

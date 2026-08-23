// Reading TEXT out of a live page (card 118, decisions/40-page-context-access.md).
//
// The two pulls decisions/40 defines — the user's current selection, and a
// readability-lite extraction of the page — as PURE functions over a
// `Document`. `src/content/relay.ts` is a composition root and passes it the
// real `document`; a test passes a jsdom one. Nothing here touches
// `chrome.*`, reads a global, or keeps state between calls, which is what
// makes a DOM walk that has to behave on every page in the world testable at
// all.
//
// DEPENDENCY-FREE ON PURPOSE. decisions/40 says "a dependency-free DOM walk
// in the relay (readability-lite)", and the relay is a content script
// injected at `document_start` into every page the user visits — shipping
// Readability.js or a DOM library into that bundle is weight on every page
// load, for a feature used on a gesture. What follows is ~200 lines of
// `Node`/`Element` and two regexes.
//
// UNTRUSTED. Every string produced here is page-authored. It is data all the
// way out: it is never parsed as markup, never interpolated into anything
// that executes, and a turn fences it exactly like a tool result
// (decisions/17, decisions/40). The heading markers this file emits are the
// one exception worth naming and they are OURS, not the page's — see
// `HEADING_PREFIX` below.
//
// THE CAP. Measured on the three fixtures in ./page-extraction.test.ts (an
// article-like page, a nav-heavy app shell, and a synthetic huge page); see
// {@link PAGE_EXTRACT_CAP_BYTES} for the numbers and the reasoning.

/** The result of one extraction: the text, and whether it stops at the cap rather than at the end of the content. */
export interface ExtractedText {
  text: string;
  truncated: boolean;
  /** UTF-8 byte length of `text` — the unit the cap is measured in. */
  bytes: number;
}

/**
 * Hard cap on an extraction, in UTF-8 BYTES.
 *
 * 16 KB, chosen against the three fixtures in ./page-extraction.test.ts and
 * MEASURED there (the "cap measurement" block pins these, so the reasoning
 * cannot drift away from the code):
 *
 *   article-like page — a long (~2,400-word) post inside `<main>`, wrapped in
 *   a header, a primary nav, a related-links `<aside>` and a footer:
 *       13,430 bytes extracted, `truncated: false`. A LONG article fits
 *       whole; a typical 800-1,500-word post lands around 5-9 KB, i.e. at
 *       roughly half the budget.
 *
 *   nav-heavy app shell — a 60-item sidebar menu, breadcrumbs, a 90-link
 *   footer farm, a hidden toast and a thin content pane:
 *       62 bytes extracted (`"# Dashboard\n\nYou have three open items…"`).
 *       The noise heuristics do the work here, not the cap: the shell is
 *       ~7 KB of raw text and none of it is content.
 *
 *   synthetic huge page — 600 paragraphs, ~317,000 characters of body text:
 *       truncated at exactly 16,000 bytes, and the whole walk takes ~40ms
 *       under jsdom (which is slower per node than Chrome's own DOM).
 *
 * So the cap binds on ~5% of pages by these fixtures' shape, and where it
 * binds it is because the page really is an archive rather than an article.
 *
 * BYTES, NOT CHARACTERS, because the thing being protected is the model's
 * context window and the tokenizer sees bytes: a page of CJK text is ~3x the
 * bytes of the same character count in ASCII and costs proportionally more.
 * A character cap would silently let one page through at 3x the budget of
 * another.
 *
 * WHY THIS SIZE. 16 KB is roughly 4k tokens — enough that a genuine article
 * arrives whole (the measurement above is the point of the fixtures), and
 * small enough that a page cannot crowd out the conversation on the 8k-context
 * local models this extension is built for (decisions/04). decisions/40's
 * consequences require the cap to be STATED in the truncation note, so this
 * number is user-visible and moving it is a visible change, not a tuning knob.
 *
 * A selection is capped by the same number. A user who selects a whole huge
 * page has asked for the same thing "share page" asks for, and the budget it
 * would spend is the same budget.
 */
export const PAGE_EXTRACT_CAP_BYTES = 16_000;

/**
 * Ceiling on how many DOM nodes one walk will visit.
 *
 * The byte cap already stops the walk on any page with a lot of TEXT. This
 * stops it on the other pathological shape — a page with a very large,
 * mostly-hidden or mostly-skipped DOM (a virtualised grid, an ad-heavy
 * shell), where the walk could visit hundreds of thousands of elements and
 * collect almost nothing. Hitting it reports `truncated: true`, which is
 * honest: the extraction stopped early and the user must be told.
 */
const MAX_NODES_VISITED = 200_000;

// ---------------------------------------------------------------------------
// UTF-8 measurement
// ---------------------------------------------------------------------------

/**
 * UTF-8 byte length of `s`, counted directly rather than via
 * `new TextEncoder().encode(s).length`.
 *
 * The walk measures every text chunk it appends, so this runs thousands of
 * times per extraction; the encoder allocates a `Uint8Array` each call and
 * this does not. A surrogate PAIR is one 4-byte code point; a LONE surrogate
 * is what `TextEncoder` would emit as U+FFFD, which is 3 bytes — the same
 * count this returns for it, so the two agree on every string.
 */
function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        n += 4;
        i += 1;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

/**
 * The longest prefix of `s` that fits in `maxBytes` as UTF-8, cut on a code
 * point boundary.
 *
 * Cutting a UTF-8 byte array at an arbitrary index splits multi-byte code
 * points and decodes back as U+FFFD, so the cut is made in the STRING, one
 * code point at a time, and a surrogate pair is never separated.
 */
function sliceToBytes(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  let used = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    let size: number;
    let step = 1;
    if (c < 0x80) size = 1;
    else if (c < 0x800) size = 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        size = 4;
        step = 2;
      } else size = 3;
    } else size = 3;

    if (used + size > maxBytes) return s.slice(0, i);
    used += size;
    i += step - 1;
  }
  return s;
}

// ---------------------------------------------------------------------------
// The sink: an append-only text buffer with a byte budget and deferred breaks
// ---------------------------------------------------------------------------

/**
 * Collects the walk's output.
 *
 * Line breaks are DEFERRED rather than written when requested: a block
 * element asks for a break on the way in and on the way out, and a page's
 * markup nests those a dozen deep, so writing them eagerly produces a wall of
 * blank lines. Recording "the strongest break owed" and flushing it only when
 * real text arrives collapses `</div></div></p><p><div>` into exactly one
 * paragraph break, with no post-processing pass and no trailing whitespace to
 * trim.
 */
class TextSink {
  private readonly parts: string[] = [];
  private used = 0;
  /** 0 = none owed, 1 = newline, 2 = blank line. */
  private owed = 0;
  private full = false;

  constructor(private readonly capBytes: number) {}

  /** True once the budget is spent — the walk stops as soon as this is set. */
  get isFull(): boolean {
    return this.full;
  }

  /** Ask for a break before the next text. The strongest request wins; nothing is written until text actually follows. */
  requestBreak(level: 1 | 2): void {
    if (this.parts.length === 0) return; // never lead with blank lines
    if (level > this.owed) this.owed = level;
  }

  /** Append page text. `chunk` must already be whitespace-collapsed. */
  push(chunk: string): void {
    if (this.full || chunk === "") return;

    const separator =
      this.owed === 2 ? "\n\n" : this.owed === 1 ? "\n" : this.parts.length ? " " : "";
    this.owed = 0;

    const remaining = this.capBytes - this.used - separator.length;
    if (remaining <= 0) {
      this.full = true;
      return;
    }

    const size = utf8Length(chunk);
    if (size <= remaining) {
      if (separator) this.parts.push(separator);
      this.parts.push(chunk);
      this.used += separator.length + size;
      return;
    }

    // The chunk alone overruns what is left. Take the prefix that fits rather
    // than dropping it whole: a page whose body is one enormous text node
    // would otherwise extract to nothing at all.
    const head = sliceToBytes(chunk, remaining);
    if (head) {
      if (separator) this.parts.push(separator);
      this.parts.push(head);
      this.used += separator.length + utf8Length(head);
    }
    this.full = true;
  }

  finish(truncatedByWalk: boolean): ExtractedText {
    const text = this.parts.join("");
    return { text, truncated: truncatedByWalk || this.full, bytes: utf8Length(text) };
  }
}

// ---------------------------------------------------------------------------
// What to skip, and what a tag means for layout
// ---------------------------------------------------------------------------

/**
 * Elements whose text is never page CONTENT: code, styling, embedded
 * documents, and form widgetry whose text is UI rather than prose.
 *
 * `SVG`/`CANVAS`/`VIDEO` are here for their fallback and `<title>`/`<desc>`
 * text, which reads as gibberish out of context. `IFRAME` is here because a
 * content script scoped to the top frame (`all_frames: false`,
 * manifest.config.ts) cannot see into one anyway — its children are a
 * separate `Document` this walk never receives.
 */
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "IFRAME",
  "FRAME",
  "FRAMESET",
  "OBJECT",
  "EMBED",
  "SVG",
  "CANVAS",
  "VIDEO",
  "AUDIO",
  "SOURCE",
  "TRACK",
  "MAP",
  "AREA",
  "LINK",
  "META",
  "BASE",
  "HEAD",
  "SELECT",
  "OPTION",
  "OPTGROUP",
  "DATALIST",
]);

/**
 * Structural chrome — the site's furniture rather than the page's content.
 *
 * `NAV`, `FOOTER` and `ASIDE` are the three decisions/40 names, and they are
 * the three that carry almost all of the link-farm noise on a real page.
 * `HEADER` is deliberately NOT here: on a great many pages the article's own
 * `<header>` is where its `<h1>` lives, and dropping it would cost the single
 * most useful line of the extract. The ARIA landmark equivalents are matched
 * too (`role="navigation"` and friends), since a `<div role="navigation">` is
 * the same furniture written differently.
 */
const NOISE_TAGS = new Set(["NAV", "FOOTER", "ASIDE"]);
const NOISE_ROLES = new Set(["navigation", "banner", "contentinfo", "complementary", "search"]);

/** Tags that read as their own paragraph — a blank line before and after. */
const PARAGRAPH_TAGS = new Set([
  "P",
  "SECTION",
  "ARTICLE",
  "MAIN",
  "BLOCKQUOTE",
  "PRE",
  "UL",
  "OL",
  "DL",
  "TABLE",
  "FIGURE",
  "HR",
  "ADDRESS",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

/** Tags that read as their own line — one newline before and after. */
const LINE_TAGS = new Set([
  "DIV",
  "LI",
  "TR",
  "TD",
  "TH",
  "DT",
  "DD",
  "HEADER",
  "FIGCAPTION",
  "CAPTION",
  "FORM",
  "FIELDSET",
  "LEGEND",
  "LABEL",
  "SUMMARY",
  "DETAILS",
  "BUTTON",
]);

/**
 * The marker a heading gets, by level. Markdown's own `#` run: the transcript
 * already renders assistant prose as Markdown (src/ui/components/Markdown.svelte),
 * and a model reading a fenced block recognises the convention without being
 * told what it means.
 *
 * This is the one thing in the output that is not verbatim page text, and it
 * is written by THIS file, never by the page: a page whose prose happens to
 * contain `###` gets it back as literal text inside the fence, with no
 * structural meaning, because the fence (decisions/17) is what decides how the
 * whole block is read.
 */
function headingPrefix(tag: string): string {
  return "#".repeat(Number(tag.slice(1)));
}

const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

/**
 * An `Element` in a browser new enough to have the CSS-aware visibility
 * check. Chrome 105+ has it; jsdom does not, which is exactly why the
 * attribute heuristics below are not a fallback but the baseline.
 */
interface MaybeCheckVisibility {
  checkVisibility?: (options?: { visibilityProperty?: boolean }) => boolean;
}

/**
 * Whether an element (and therefore its whole subtree) should be treated as
 * invisible.
 *
 * Three cheap attribute checks first — `hidden`, `aria-hidden="true"`, and an
 * inline `display:none`/`visibility:hidden` — then the platform's own
 * `checkVisibility()` where it exists, which is the only one of the four that
 * can see a stylesheet. `getComputedStyle` is deliberately NOT used: it is
 * the same information at many times the cost, on every element of every
 * page, for a walk that runs on a user gesture.
 *
 * Erring toward VISIBLE is the right bias: including a bit of hidden text
 * costs a few bytes of a capped budget, while wrongly excluding a subtree
 * loses content the user asked to share.
 */
function isHidden(el: Element): boolean {
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;

  const inline = el.getAttribute("style");
  if (inline && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(inline)) {
    return true;
  }

  const check = (el as Element & MaybeCheckVisibility).checkVisibility;
  if (typeof check === "function") {
    try {
      if (!check.call(el, { visibilityProperty: true })) return true;
    } catch {
      // A partial implementation that rejects the options bag. Falling
      // through means "assume visible", which is the safe bias above.
    }
  }
  return false;
}

function isNoise(el: Element): boolean {
  if (NOISE_TAGS.has(el.tagName)) return true;
  const role = el.getAttribute("role");
  return role !== null && NOISE_ROLES.has(role.trim().toLowerCase());
}

/** Collapse every run of whitespace — newlines in the markup included — to a single space. */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/**
 * Iterative rather than recursive, with an explicit stack.
 *
 * A recursive walk is shorter and blows the JS stack on a deeply-nested page
 * — and "deeply nested" is not exotic: a chat log or a comment thread built
 * out of nested `<div>`s reaches thousands of levels. The stack holds either
 * a node still to visit or a CLOSE marker carrying the break its element owes
 * on the way out, which is what lets one loop do a job that reads naturally
 * as pre-order/post-order recursion.
 */
type WalkItem = { node: Node } | { close: 1 | 2 };

function isCloseMarker(item: WalkItem): item is { close: 1 | 2 } {
  return "close" in item;
}

function walk(root: Node, sink: TextSink): boolean {
  const stack: WalkItem[] = [{ node: root }];
  let visited = 0;

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;

    if (isCloseMarker(item)) {
      sink.requestBreak(item.close);
      continue;
    }

    if (sink.isFull) return false;
    visited += 1;
    if (visited > MAX_NODES_VISITED) return true;

    const node = item.node;

    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text = collapse(node.nodeValue ?? "");
      if (text) sink.push(text);
      continue;
    }

    if (node.nodeType !== 1 /* ELEMENT_NODE */) continue;

    const el = node as Element;
    const tag = el.tagName;

    if (SKIP_TAGS.has(tag) || isNoise(el) || isHidden(el)) continue;

    if (tag === "BR") {
      sink.requestBreak(1);
      continue;
    }

    const paragraph = PARAGRAPH_TAGS.has(tag);
    const line = !paragraph && LINE_TAGS.has(tag);
    if (paragraph) sink.requestBreak(2);
    else if (line) sink.requestBreak(1);

    if (paragraph || line) stack.push({ close: paragraph ? 2 : 1 });

    // Children in reverse: the stack pops them back into document order.
    const children = el.childNodes;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      // `item(i)` is in-range by construction.
      const child = children.item(i);
      if (child) stack.push({ node: child });
    }

    if (HEADING_TAGS.has(tag)) sink.push(headingPrefix(tag));
    else if (tag === "LI") sink.push("-");
  }

  return false;
}

/**
 * Picks what to walk: the page's own main content when it says where that is,
 * the whole body otherwise.
 *
 * This is the other half of the noise story (the skip lists being the first).
 * A page that marks up `<main>` or `[role=main]` has told us where its
 * content is, and honouring that is both more accurate and much cheaper than
 * walking a shell and heuristically discarding most of it.
 */
function contentRoots(doc: Document): Element[] {
  const roots: Element[] = [];
  const main = doc.querySelector("main, [role=main]");
  if (main) roots.push(main);
  else {
    const article = doc.querySelector("article");
    if (article) roots.push(article);
  }
  if (doc.body) roots.push(doc.body);
  return roots;
}

/**
 * A readability-lite text extraction of `doc`, hard-capped at `capBytes` UTF-8
 * bytes.
 *
 * Never throws — a document with no `<body>`, an empty one, or one whose
 * content is entirely inside skipped elements all extract to
 * `{text: "", truncated: false}`. "Nothing to share" is an answer, not a
 * failure (decisions/34).
 */
export function extractPageText(
  doc: Document,
  capBytes: number = PAGE_EXTRACT_CAP_BYTES,
): ExtractedText {
  // The preferred root can be a `<main>` that is empty or a decorative
  // `<article>` wrapper, so its result is only KEPT when it produced
  // something; otherwise the body is walked instead. Two walks in that case,
  // both bounded by the same cap.
  for (const root of contentRoots(doc)) {
    const sink = new TextSink(capBytes);
    const hitNodeLimit = walk(root, sink);
    const result = sink.finish(hitNodeLimit);
    if (result.text !== "") return result;
  }
  return { text: "", truncated: false, bytes: 0 };
}

/**
 * The user's current selection in `doc`, trimmed and capped.
 *
 * A collapsed selection (a bare caret) and no selection at all both produce
 * `{text: ""}` — decisions/40 offers the composer chip only when there is
 * something to offer, and this is the value that says there isn't. It is a
 * SUCCESS, never an error.
 *
 * FRAMES. `document.getSelection()` reports only what is selected in THIS
 * document. Text the user selected inside an `<iframe>` belongs to that
 * frame's own document and is invisible here — the relay runs in the top
 * frame only (`all_frames: false`, manifest.config.ts), so a selection in an
 * embedded frame reads as no selection. That is the honest answer for the
 * frame this code can see, and widening it would mean injecting into every
 * frame of every page, which decisions/16's `all_frames: false` deliberately
 * does not do.
 *
 * Unlike {@link extractPageText}, line structure is PRESERVED: a selection
 * spanning several paragraphs comes back from the platform with newlines in
 * it, and those newlines are the user's own sense of what they selected.
 * Only horizontal whitespace is collapsed.
 */
/**
 * Text selected inside a form control, or `undefined` when there is none.
 *
 * `document.getSelection()` does NOT cover `<input>`/`<textarea>` — a
 * selection there lives on the element's own `selectionStart`/`End` (found
 * live: "Hello" selected in Google's search box read as no selection at
 * all, and the model was asked about text it never received — Jonathan,
 * 2026-08-23). Passwords are excluded outright: a selected password is
 * still a password. Reading `selectionStart` THROWS on input types that
 * don't support it (email/number in some engines), hence the try.
 */
function formControlSelection(doc: Document): string | undefined {
  const el = doc.activeElement;
  const isTextArea = el instanceof HTMLTextAreaElement;
  const isInput = el instanceof HTMLInputElement;
  if (!isTextArea && !isInput) return undefined;
  if (isInput && el.type === "password") return undefined;
  try {
    const { selectionStart, selectionEnd, value } = el;
    if (selectionStart === null || selectionEnd === null || selectionStart === selectionEnd) {
      return undefined;
    }
    return value.slice(selectionStart, selectionEnd);
  } catch {
    return undefined;
  }
}

export function extractSelection(
  doc: Document,
  capBytes: number = PAGE_EXTRACT_CAP_BYTES,
): ExtractedText {
  const selection = doc.getSelection?.();
  const documentSelection = selection && !selection.isCollapsed ? selection.toString() : undefined;
  // The document selection wins when both somehow exist — it is the one the
  // user made most visibly — but in practice they are mutually exclusive:
  // selecting in an input collapses the document selection and vice versa.
  const raw = documentSelection ?? formControlSelection(doc);
  if (raw === undefined) return { text: "", truncated: false, bytes: 0 };
  const normalized = raw
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized === "") return { text: "", truncated: false, bytes: 0 };

  const bytes = utf8Length(normalized);
  if (bytes <= capBytes) return { text: normalized, truncated: false, bytes };

  const head = sliceToBytes(normalized, capBytes);
  return { text: head, truncated: true, bytes: utf8Length(head) };
}

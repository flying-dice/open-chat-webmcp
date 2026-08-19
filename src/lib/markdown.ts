/**
 * Streaming-tolerant markdown -> sanitised HTML pipeline.
 *
 * See boards/project-backlog/10-streaming-markdown-renderer.md for the card
 * and decisions/02-mainworld-webmcp-bridge.md for why sanitisation is not
 * optional: assistant text is influenced by tool results returned from
 * arbitrary web pages, which are hostile input by assumption.
 *
 * Pipeline: raw markdown -> `balanceIncompleteMarkdown` (best-effort repair
 * of syntax that is still mid-stream) -> `marked` (CommonMark/GFM parser,
 * raw HTML passthrough disabled) -> `DOMPurify` (strict allowlist, final
 * authority on what reaches the DOM). Both libraries are pure DOM/string
 * manipulation — no `eval`/`new Function` — so they are compatible with
 * MV3's CSP (verified by grepping their bundles and by `npm run build`
 * producing no unsafe-eval warnings).
 */

import { Marked } from "marked";
import DOMPurify from "dompurify";

// ---------------------------------------------------------------------------
// Streaming tolerance
// ---------------------------------------------------------------------------
//
// Token-by-token streaming constantly hands us syntax that is not yet
// closed. Two different mechanisms handle this:
//
// 1. Fenced code blocks: CommonMark itself defines that an unterminated
//    fence runs to the end of the document, so a fence opened mid-stream
//    already renders as "a code block being typed" with no extra work —
//    it never flips back to literal backticks as more text arrives. We
//    only need to make sure we don't try to "balance" *through* an open
//    fence (that would corrupt code content), so `balanceIncompleteMarkdown`
//    detects an odd number of fence lines and leaves the text untouched
//    in that case.
//
// 2. Inline markers (`**bold**`, `` `code` ``, `~~strike~~`, `_em_`) have no
//    such auto-extend rule: CommonMark's delimiter matching only pairs a
//    marker with a *later* matching marker, so a lone trailing `**` just
//    renders as two literal asterisks until its partner arrives — then it
//    "snaps" into bold on the very next token. To avoid that snap (visible
//    as a block-type-ish flicker between literal text and formatted text),
//    we scan the trailing in-progress block (the text after the last blank
//    line, i.e. the block currently being typed) for an odd count of each
//    marker and virtually append the missing closer *for this render pass
//    only* — the underlying buffer the caller owns is never mutated.

const FENCE_BACKTICK_RE = /^ {0,3}`{3,}.*$/gm;
const FENCE_TILDE_RE = /^ {0,3}~{3,}.*$/gm;

function hasUnterminatedFence(text: string): boolean {
  const backtickCount = text.match(FENCE_BACKTICK_RE)?.length ?? 0;
  const tildeCount = text.match(FENCE_TILDE_RE)?.length ?? 0;
  return backtickCount % 2 === 1 || tildeCount % 2 === 1;
}

/** Append a closing marker if `marker` occurs an odd number of times in `text`. */
function closeIfUnmatched(text: string, marker: string): string {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const count = text.match(new RegExp(escaped, "g"))?.length ?? 0;
  return count % 2 === 1 ? text + marker : text;
}

/**
 * Count "lone" single-character emphasis markers, i.e. occurrences of
 * `char` that are not adjacent to another `char` (so they are not part of
 * a `**`/`__` run, which `closeIfUnmatched` already handled separately).
 */
function closeIfUnmatchedSingle(text: string, char: "*" | "_"): string {
  const escaped = char === "*" ? "\\*" : "_";
  const re = new RegExp(`(?<!${escaped})${escaped}(?!${escaped})`, "g");
  const count = text.match(re)?.length ?? 0;
  return count % 2 === 1 ? text + char : text;
}

function balanceInline(tail: string): string {
  let out = tail;
  out = closeIfUnmatched(out, "`");
  out = closeIfUnmatched(out, "**");
  out = closeIfUnmatched(out, "__");
  out = closeIfUnmatched(out, "~~");
  out = closeIfUnmatchedSingle(out, "*");
  out = closeIfUnmatchedSingle(out, "_");
  return out;
}

/**
 * Best-effort repair of markdown that may be mid-stream. Never throws, and
 * is idempotent on complete documents (a fully-formed document has nothing
 * to balance, so it comes back unchanged).
 */
export function balanceIncompleteMarkdown(source: string): string {
  if (source.length === 0) return source;

  // An open fence already renders sensibly as-is (see comment above) — do
  // not attempt inline balancing, which could corrupt code content or land
  // a synthetic marker on the wrong side of the fence boundary.
  if (hasUnterminatedFence(source)) return source;

  // Only balance the block currently being typed (the text after the last
  // blank line). Emphasis delimiters never pair across a block boundary in
  // CommonMark, so earlier, already-settled blocks are left untouched —
  // both for correctness and so we don't re-scan the whole transcript on
  // every token.
  const boundary = source.lastIndexOf("\n\n");
  const head = boundary === -1 ? "" : source.slice(0, boundary + 2);
  const tail = boundary === -1 ? source : source.slice(boundary + 2);

  return head + balanceInline(tail);
}

// ---------------------------------------------------------------------------
// JSON pretty-printing for tool-result blobs
// ---------------------------------------------------------------------------

function prettyPrintIfJson(lang: string | undefined, code: string): string {
  const trimmed = code.trim();
  if (trimmed.length === 0) return code;

  const langLooksJson = lang !== undefined && /^json[c5]?$/i.test(lang.trim());
  const contentLooksJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));

  if (!langLooksJson && !contentLooksJson) return code;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // Mid-stream JSON is usually incomplete and won't parse yet — fall
    // back to the raw text rather than throwing, it will pretty-print on
    // a later token once it becomes valid.
    return code;
  }
}

// ---------------------------------------------------------------------------
// HTML escaping for content we build ourselves (code block wrapper)
// ---------------------------------------------------------------------------

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

// ---------------------------------------------------------------------------
// marked configuration
// ---------------------------------------------------------------------------

function renderCodeBlock({ text, lang }: { text: string; lang?: string }): string {
  const langToken = (lang ?? "").trim().split(/\s+/)[0] ?? "";
  const displayCode = prettyPrintIfJson(langToken, text);
  const escapedCode = escapeHtml(displayCode);
  const classAttr = langToken ? ` class="language-${escapeHtml(langToken.toLowerCase())}"` : "";
  const label = langToken ? escapeHtml(langToken) : "text";

  return (
    `<div class="md-code" data-code-block>` +
    `<div class="md-code-header">` +
    `<span class="md-code-lang">${label}</span>` +
    `<button type="button" class="md-copy-btn" data-copy-button>Copy</button>` +
    `</div>` +
    `<pre><code${classAttr}>${escapedCode}</code></pre>` +
    `</div>`
  );
}

const markedInstance = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code: renderCodeBlock,
    // marked's default `html` renderer writes any raw `<...>` sequence it
    // tokenized straight into the output HTML string verbatim. Override it
    // to escape instead, so raw HTML in the markdown source is neutralised
    // to inert text at the marked layer itself — DOMPurify below is still
    // the final, authoritative sanitisation pass for everything else
    // (including our own generated wrapper markup), but "no raw HTML
    // passthrough" holds even before that pass runs.
    html: ({ text }) => escapeHtml(text),
  },
});

// ---------------------------------------------------------------------------
// DOMPurify configuration — strict allowlist, no raw HTML passthrough
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "s",
  "code",
  "pre",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "div",
  "span",
  "button",
];

const ALLOWED_ATTR = [
  "href",
  "title",
  "class",
  "target",
  "rel",
  "type",
  "colspan",
  "rowspan",
  "data-copy-button",
  "data-code-block",
];

// Only http(s) and mailto links are ever allowed through — no javascript:,
// data:, or other schemes, regardless of what a tool result tries to inject.
const SAFE_URI_REGEXP = /^(?:https?:|mailto:)/i;

let hooksInstalled = false;
function ensureSanitizerHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  // Every link opens in a new tab with rel="noopener noreferrer" — set
  // unconditionally on every <a> that survives sanitisation, never trusting
  // attributes that came from the markdown source itself.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const href = node.getAttribute("href");
      if (!href || !SAFE_URI_REGEXP.test(href)) {
        node.removeAttribute("href");
      }
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

/**
 * Render a (possibly mid-stream) markdown string to sanitised HTML safe to
 * inject with `{@html ...}`.
 *
 * - No raw HTML passthrough: marked's own HTML tokenizer is bypassed for
 *   anything DOMPurify wouldn't allow anyway, and DOMPurify is the final,
 *   authoritative allowlist pass regardless of what marked produced.
 * - `<img>` is intentionally not in the allowlist: an attacker-controlled
 *   tool result could otherwise turn an image src into a data-exfiltration
 *   channel (the browser fetches it unconditionally). Image markdown still
 *   parses without throwing; it's just dropped.
 * - Every link is forced to `target="_blank" rel="noopener noreferrer"`
 *   and restricted to http(s)/mailto schemes.
 */
export function renderMarkdown(source: string): string {
  ensureSanitizerHooks();

  const balanced = balanceIncompleteMarkdown(source);

  let rawHtml: string;
  try {
    rawHtml = markedInstance.parse(balanced, { async: false }) as string;
  } catch {
    // marked is designed to be a total function over its input and should
    // never throw, but if a future edge case does, degrade to plain
    // (escaped) text rather than breaking the panel.
    rawHtml = `<p>${escapeHtml(source)}</p>`;
  }

  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}

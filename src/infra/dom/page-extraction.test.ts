// @vitest-environment jsdom
//
// Tests for src/infra/dom/page-extraction.ts (card 118,
// boards/project-backlog/118-page-context-transport.md,
// decisions/40-page-context-access.md).
//
// WHY THIS FILE OVERRIDES THE ENVIRONMENT. The "domain" Vitest project runs
// `src/infra/**/*.test.ts` on `node` deliberately (vitest.config.ts): the unit
// layer must not have a DOM lying around to reach for by accident. This one
// module is the exception the rule is FOR — it is the DOM adapter, its whole
// content is a `Document` walk, and the point of extracting it out of
// src/content/relay.ts was that a walk which has to behave on every page in
// the world can be exercised against fixtures instead of a real browser. The
// per-file `@vitest-environment` docblock above scopes jsdom to this file
// alone rather than widening the project's environment.
//
// jsdom IS NOT CHROME, and two of the differences matter here:
//   - `Element.checkVisibility()` does not exist, so the CSS-aware half of
//     `isHidden` is never exercised below. Everything these tests prove about
//     hidden content is proved through the attribute heuristics — which is
//     the right thing to pin, since those are the half that has to work in
//     both engines.
//   - a `DOMParser` document has no browsing context, so its
//     `getSelection()` returns `null`. That is used deliberately below as the
//     "no Selection API for this document" case.

import { afterEach, describe, expect, it } from "vitest";
import {
  extractPageText,
  extractSelection,
  MIN_SELECTION_CHARS,
  PAGE_EXTRACT_CAP_BYTES,
  selectionIdentity,
} from "./page-extraction";

/** A fresh, isolated `Document` per fixture — no shared global state between tests. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

// ---------------------------------------------------------------------------
// Fixtures
//
// Real-ish rather than minimal: the cap in page-extraction.ts is justified by
// what these three measure, so they have to look like the pages the feature
// will actually meet. See the "cap measurement" describe at the bottom.
// ---------------------------------------------------------------------------

const SENTENCES = [
  "The relay runs in the extension's isolated world and never shares a scope with the page.",
  "Every value that crosses to the service worker is a typed message with a discriminated tag.",
  "A tool call is arbitrary page-authored code, so it gets the longest budget on the ladder.",
  "Extraction, by contrast, is one bounded synchronous walk that stops at a byte cap.",
  "That distinction is what keeps a wedged page from costing the user twenty seconds.",
  "Nothing about a page leaves it without a user gesture and a visible artifact in the panel.",
];

/** ~`words` words of plausible prose, split into paragraphs. Deterministic. */
function prose(paragraphs: number, sentencesEach: number): string {
  const out: string[] = [];
  let n = 0;
  for (let p = 0; p < paragraphs; p += 1) {
    const parts: string[] = [];
    for (let s = 0; s < sentencesEach; s += 1) {
      parts.push(SENTENCES[n % SENTENCES.length]!);
      n += 1;
    }
    out.push(`<p>${parts.join(" ")}</p>`);
  }
  return out.join("\n");
}

/** An article-like page: site chrome around one long post inside `<main>`. */
const ARTICLE_PAGE = `<!doctype html><html><head><title>How the relay reads a page</title>
<style>.hidden{display:none}</style><script>window.analytics=1;</script></head>
<body>
  <header class="site">
    <a href="/">Openchat</a>
    <nav aria-label="Primary"><a href="/docs">Docs</a><a href="/blog">Blog</a><a href="/pricing">Pricing</a></nav>
  </header>
  <main>
    <article>
      <h1>How the relay reads a page</h1>
      <p class="byline">Posted by <a href="/authors/jt">Jonathan</a> on Tuesday.</p>
      ${prose(9, 5)}
      <h2>The timeout ladder</h2>
      ${prose(8, 5)}
      <h3>What the worker does</h3>
      ${prose(7, 5)}
      <ul><li>Selection is pulled at focus and at send.</li><li>An extract is pulled only on request.</li></ul>
      ${prose(6, 5)}
    </article>
  </main>
  <aside class="related"><h2>Related</h2><a href="/a">One</a><a href="/b">Two</a><a href="/c">Three</a></aside>
  <footer><p>Copyright 2026. All rights reserved.</p><nav><a href="/legal">Legal</a><a href="/privacy">Privacy</a></nav></footer>
  <script>console.log("tracking");</script>
</body></html>`;

/** A nav-heavy app shell: menus and link farms, very little content. */
function navHeavyPage(): string {
  const menu = Array.from(
    { length: 60 },
    (_, i) => `<li><a href="/section/${i}">Section number ${i} of the product catalogue</a></li>`,
  ).join("");
  const footerLinks = Array.from(
    { length: 90 },
    (_, i) => `<a href="/f/${i}">Footer destination ${i}</a>`,
  ).join("");
  return `<!doctype html><html><head><title>Dashboard</title></head><body>
    <div id="app">
      <nav class="sidebar"><ul>${menu}</ul></nav>
      <div role="navigation"><a href="/x">Breadcrumb one</a><a href="/y">Breadcrumb two</a></div>
      <div class="content">
        <h1>Dashboard</h1>
        <p>You have three open items and one overdue review.</p>
        <div class="toast" hidden>Saved successfully.</div>
        <div style="display:none">Hidden template row</div>
        <span aria-hidden="true">decorative</span>
      </div>
      <aside class="promo"><p>Upgrade today for unlimited seats.</p></aside>
      <footer>${footerLinks}</footer>
    </div>
  </body></html>`;
}

/** A huge page: far more body text than any cap should ever pass through. */
function hugePage(): string {
  return `<!doctype html><html><head><title>Archive</title></head><body><main>
    <h1>Archive</h1>${prose(600, 6)}</main></body></html>`;
}

// ---------------------------------------------------------------------------
// extractPageText — structure
// ---------------------------------------------------------------------------

describe("extractPageText", () => {
  it("keeps the article's prose and headings, and drops nav, aside, footer, script and style", () => {
    const { text, truncated } = extractPageText(parse(ARTICLE_PAGE));

    expect(text).toContain("# How the relay reads a page");
    expect(text).toContain("## The timeout ladder");
    expect(text).toContain("### What the worker does");
    expect(text).toContain("The relay runs in the extension's isolated world");
    expect(truncated).toBe(false);

    // Site chrome, in all four of the shapes the heuristics recognise.
    expect(text).not.toContain("Pricing"); // <nav>
    expect(text).not.toContain("Related"); // <aside>
    expect(text).not.toContain("All rights reserved"); // <footer>
    expect(text).not.toContain("window.analytics"); // <script>
    expect(text).not.toContain("display:none"); // <style>
  });

  it("keeps link TEXT but never the href — a URL is bytes the model did not ask for and a target it must not be handed", () => {
    const { text } = extractPageText(parse(ARTICLE_PAGE));
    expect(text).toContain("Jonathan");
    expect(text).not.toContain("/authors/jt");
    expect(text).not.toContain("href");
  });

  it("marks list items and separates blocks, without emitting runs of blank lines from nested markup", () => {
    const { text } = extractPageText(
      parse(
        "<body><div><div><div><p>One</p></div></div><ul><li>Two</li><li>Three</li></ul></div></body>",
      ),
    );
    expect(text).toContain("- Two");
    expect(text).toContain("- Three");
    expect(text).not.toMatch(/\n{3}/);
    expect(text.startsWith("One")).toBe(true);
  });

  it("prefers <main> over the whole body, so a nav-heavy shell extracts almost nothing but its content", () => {
    const withMain = extractPageText(
      parse(
        "<body><nav><a href=/>Home</a></nav><main><p>The only thing that matters.</p></main><footer>Legal</footer></body>",
      ),
    );
    expect(withMain.text).toBe("The only thing that matters.");
  });

  it("falls back to the body when the preferred root is empty rather than reporting an empty page", () => {
    const { text } = extractPageText(
      parse("<body><main></main><div><p>Content lives outside main on this page.</p></div></body>"),
    );
    expect(text).toBe("Content lives outside main on this page.");
  });

  it("skips hidden subtrees: [hidden], aria-hidden and inline display:none/visibility:hidden", () => {
    const { text } = extractPageText(
      parse(
        `<body><p>Visible.</p>
         <div hidden><p>A</p></div>
         <div aria-hidden="true"><p>B</p></div>
         <div style="color:red; display: none"><p>C</p></div>
         <div style="visibility:hidden"><p>D</p></div>
         <div style="display:block"><p>E</p></div></body>`,
      ),
    );
    expect(text).toContain("Visible.");
    expect(text).toContain("E");
    for (const hidden of ["A", "B", "C", "D"]) {
      expect(text.split(/\s+/)).not.toContain(hidden);
    }
  });

  it("collapses whitespace inside a text node — markup indentation is not content", () => {
    const { text } = extractPageText(parse("<body><p>  one\n\n   two\t\tthree  </p></body>"));
    expect(text).toBe("one two three");
  });

  it("survives a document with no body, an empty body, and a body of nothing but script/style", () => {
    for (const html of [
      "<html><head><title>t</title></head></html>",
      "<body></body>",
      "<body><script>1</script><style>a{}</style><noscript>no js</noscript></body>",
    ]) {
      expect(extractPageText(parse(html))).toEqual({ text: "", truncated: false, bytes: 0 });
    }
  });

  // This test's claim is STACK SAFETY (an iterative walk, no RangeError),
  // not speed — jsdom PARSING 5,000 nested divs is what's slow, and on the
  // CI runner it measured 3.9s on one run and past vitest's 5s default on
  // the next (v0.5.0's tag pipelines). Hence the explicit 30s timeout. The
  // keystroke-latency claim lives in the separate "fast enough" test, which
  // times only the walk. (Comment sits ABOVE the call: biome's formatter is
  // unstable on comments inside this argument list and reshuffles them each
  // pass, failing its own ci check forever.)
  it("does not blow the stack on a pathologically deep DOM", { timeout: 30_000 }, () => {
    const depth = 5_000;
    const html = `<body>${"<div>".repeat(depth)}deep${"</div>".repeat(depth)}</body>`;
    expect(extractPageText(parse(html)).text).toBe("deep");
  });
});

describe("extractSelection — form controls", () => {
  // document.getSelection() never covers input/textarea selections; these
  // read the active element's selectionStart/End instead (found live:
  // "Hello" selected in Google's search box extracted as nothing — Jonathan,
  // 2026-08-23). These tests use the jsdom GLOBAL document because a
  // DOMParser document has no browsing context, no focus and no
  // activeElement — exactly why the other suites above use it.
  function mount(el: HTMLElement): void {
    document.body.appendChild(el);
  }
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reads a selection inside a focused <input>", () => {
    const input = document.createElement("input");
    input.value = "Hello world";
    mount(input);
    input.focus();
    input.setSelectionRange(0, 5);
    expect(extractSelection(document).text).toBe("Hello");
  });

  it("reads a selection inside a focused <textarea>", () => {
    const area = document.createElement("textarea");
    area.value = "line one\nline two";
    mount(area);
    area.focus();
    area.setSelectionRange(9, 17);
    expect(extractSelection(document).text).toBe("line two");
  });

  it("NEVER reads a selection inside a password input — a selected password is still a password", () => {
    const input = document.createElement("input");
    input.type = "password";
    input.value = "hunter2!";
    mount(input);
    input.focus();
    input.setSelectionRange(0, 8);
    expect(extractSelection(document)).toEqual({ text: "", truncated: false, bytes: 0 });
  });

  it("a collapsed input selection reads as no selection", () => {
    const input = document.createElement("input");
    input.value = "Hello";
    mount(input);
    input.focus();
    input.setSelectionRange(3, 3);
    expect(extractSelection(document)).toEqual({ text: "", truncated: false, bytes: 0 });
  });
});

// ---------------------------------------------------------------------------
// extractPageText — the cap
// ---------------------------------------------------------------------------

describe("extractPageText capping", () => {
  it("stops at the cap on a huge page and says so", () => {
    const result = extractPageText(parse(hugePage()));
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBeLessThanOrEqual(PAGE_EXTRACT_CAP_BYTES);
    // Close to it, not a fraction of it: the walk fills the budget rather
    // than bailing at the first block that would overrun.
    expect(result.bytes).toBeGreaterThan(PAGE_EXTRACT_CAP_BYTES - 400);
  });

  it("counts BYTES, not characters — the same character count in CJK costs three times as much", () => {
    const ascii = extractPageText(parse(`<body><p>${"a".repeat(5_000)}</p></body>`), 1_000);
    const cjk = extractPageText(parse(`<body><p>${"漢".repeat(5_000)}</p></body>`), 1_000);
    expect(ascii.bytes).toBeLessThanOrEqual(1_000);
    expect(cjk.bytes).toBeLessThanOrEqual(1_000);
    expect(ascii.text.length).toBeGreaterThan(cjk.text.length * 2.5);
  });

  it("never cuts a multi-byte character in half", () => {
    // An odd cap that lands mid-codepoint if the cut were made on bytes.
    for (let cap = 10; cap < 24; cap += 1) {
      const { text, bytes } = extractPageText(
        parse(`<body><p>${"漢字".repeat(50)}</p></body>`),
        cap,
      );
      expect(bytes).toBeLessThanOrEqual(cap);
      expect(text).not.toContain("�");
      expect(text.split("").every((c) => c === "漢" || c === "字")).toBe(true);
    }
  });

  it("takes the prefix of one enormous text node rather than dropping it whole", () => {
    const { text, truncated } = extractPageText(
      parse(`<body><p>${"word ".repeat(20_000)}</p></body>`),
      200,
    );
    expect(truncated).toBe(true);
    expect(text.length).toBeGreaterThan(150);
  });

  it("reports truncated:false when the whole page fits", () => {
    const result = extractPageText(parse("<body><p>Short.</p></body>"));
    expect(result).toEqual({ text: "Short.", truncated: false, bytes: 6 });
  });
});

// ---------------------------------------------------------------------------
// extractSelection
// ---------------------------------------------------------------------------

/** Selects the contents of `#target` in the REAL jsdom window (a Selection needs a browsing context). */
function selectTarget(html: string): Document {
  document.body.innerHTML = html;
  const target = document.getElementById("target");
  const selection = window.getSelection();
  selection?.removeAllRanges();
  if (target) {
    const range = document.createRange();
    range.selectNodeContents(target);
    selection?.addRange(range);
  }
  return document;
}

describe("extractSelection", () => {
  it("returns the selected text, trimmed", () => {
    const doc = selectTarget("<p id='target'>   the selected sentence.   </p>");
    expect(extractSelection(doc).text).toBe("the selected sentence.");
  });

  it("preserves the selection's own line structure but collapses horizontal whitespace", () => {
    const doc = selectTarget("<div id='target'><p>First   line</p><p>Second\t\tline</p></div>");
    const { text } = extractSelection(doc);
    expect(text).toContain("First line");
    expect(text).toContain("Second line");
    expect(text).not.toMatch(/\n{3}/);
  });

  it("a COLLAPSED selection (a bare caret) is an empty success, not an error", () => {
    document.body.innerHTML = "<p id='target'>text</p>";
    const target = document.getElementById("target");
    const selection = window.getSelection();
    selection?.removeAllRanges();
    const range = document.createRange();
    range.setStart(target!.firstChild!, 2);
    range.collapse(true);
    selection?.addRange(range);

    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(extractSelection(document)).toEqual({ text: "", truncated: false, bytes: 0 });
  });

  it("no selection at all is an empty success", () => {
    document.body.innerHTML = "<p>text</p>";
    window.getSelection()?.removeAllRanges();
    expect(extractSelection(document)).toEqual({ text: "", truncated: false, bytes: 0 });
  });

  it("a selection of nothing but whitespace is an empty success", () => {
    const doc = selectTarget("<p id='target'>   \n\t  </p>");
    expect(extractSelection(doc)).toEqual({ text: "", truncated: false, bytes: 0 });
  });

  it("a document with no Selection API at all (no browsing context — the shape a cross-frame or detached document takes) reads as no selection", () => {
    // The relay runs in the top frame only (`all_frames: false`), so a
    // selection made inside an <iframe> belongs to a document this code never
    // receives. A document with no browsing context is that same situation
    // from this function's side: `getSelection()` answers null, and the
    // honest result is "nothing selected here", never a throw.
    const detached = parse("<body><p>text in another document</p></body>");
    expect(detached.getSelection()).toBeNull();
    expect(extractSelection(detached)).toEqual({ text: "", truncated: false, bytes: 0 });
  });

  it("caps a huge selection at the same byte budget an extract gets", () => {
    const doc = selectTarget(`<p id='target'>${"selected words ".repeat(4_000)}</p>`);
    const result = extractSelection(doc);
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBeLessThanOrEqual(PAGE_EXTRACT_CAP_BYTES);
  });
});

// ---------------------------------------------------------------------------
// The minimum selection length (card 129, Jonathan 2026-08-24)
//
// The floor lives in `extractSelection` and NOT in the panel on purpose: the
// send-time re-read is what attaches text to a turn, so a floor applied only
// where the chip is drawn would let a two-character selection be sent having
// never been shown to anybody — the exact thing decisions/40's
// visible-artifact rule forbids. These pin it at the one place both paths go
// through.
// ---------------------------------------------------------------------------

describe("extractSelection — the minimum length", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("a two-character selection is an empty success — no chip, and nothing to attach at send", () => {
    const doc = selectTarget("<p id='target'>ab</p>");
    expect(extractSelection(doc)).toEqual({ text: "", truncated: false, bytes: 0 });
  });

  it("three characters is offered — the floor is a floor, not a preference", () => {
    const doc = selectTarget("<p id='target'>abc</p>");
    expect(extractSelection(doc)).toEqual({ text: "abc", truncated: false, bytes: 3 });
    expect(MIN_SELECTION_CHARS).toBe(3);
  });

  it("measures AFTER trimming — a padded '  ab  ' is two characters, not six", () => {
    const doc = selectTarget("<p id='target'>  ab  </p>");
    expect(extractSelection(doc)).toEqual({ text: "", truncated: false, bytes: 0 });
  });

  it("applies to a form-control selection too — the floor is about the selection, not where it was made", () => {
    const input = document.createElement("input");
    input.value = "ab cd";
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 2); // "ab"
    expect(extractSelection(document)).toEqual({ text: "", truncated: false, bytes: 0 });
    input.setSelectionRange(0, 5); // "ab cd"
    expect(extractSelection(document).text).toBe("ab cd");
  });

  it("counts CHARACTERS, not bytes — three CJK characters are nine bytes and still qualify", () => {
    const doc = selectTarget("<p id='target'>漢字語</p>");
    expect(extractSelection(doc)).toEqual({ text: "漢字語", truncated: false, bytes: 9 });
  });
});

// ---------------------------------------------------------------------------
// selectionIdentity (card 129, decisions/40's "Live chip updates")
//
// The relay compares these between `selectionchange` events to decide whether
// anything worth telling the panel about happened. Two properties matter, and
// both are load-bearing for a promise made elsewhere: it must AGREE with
// `extractSelection` about what counts as a selection (or the relay would ping
// for selections the chip will never show, and vice versa), and it must carry
// no recoverable text (it is the only selection-derived value the relay keeps
// between events).
// ---------------------------------------------------------------------------

describe("selectionIdentity", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is empty when there is no selection", () => {
    document.body.innerHTML = "<p>text</p>";
    window.getSelection()?.removeAllRanges();
    expect(selectionIdentity(document)).toBe("");
  });

  it("is stable for the same selection — re-reading it twice is not a change", () => {
    const doc = selectTarget("<p id='target'>the selected sentence.</p>");
    expect(selectionIdentity(doc)).toBe(selectionIdentity(doc));
    expect(selectionIdentity(doc)).not.toBe("");
  });

  it("differs when the selection changes to different text of the SAME length", () => {
    const first = selectionIdentity(selectTarget("<p id='target'>abcdef</p>"));
    const second = selectionIdentity(selectTarget("<p id='target'>ghijkl</p>"));
    expect(first).not.toBe(second);
  });

  it("differs when a selection is EXTENDED — the shift+arrow case, where the anchor never moves", () => {
    document.body.innerHTML = "<p id='target'>one two three four</p>";
    const target = document.getElementById("target");
    const seen = new Set<string>();
    for (const end of [3, 7, 13, 18]) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      const range = document.createRange();
      range.setStart(target!.firstChild!, 0);
      range.setEnd(target!.firstChild!, end);
      selection?.addRange(range);
      seen.add(selectionIdentity(document));
    }
    expect(seen.size).toBe(4); // every extension read as a change
  });

  it("agrees with extractSelection about the minimum length: a two-character selection has the SAME identity as none at all, so it never pings", () => {
    const tiny = selectionIdentity(selectTarget("<p id='target'>ab</p>"));
    window.getSelection()?.removeAllRanges();
    expect(tiny).toBe(selectionIdentity(document));
    expect(tiny).toBe("");
  });

  it("does not carry the selected text — the relay keeps this value between events, and it must not be a copy of the page", () => {
    const doc = selectTarget("<p id='target'>hunter2 is not a good password</p>");
    const identity = selectionIdentity(doc);
    expect(identity).not.toContain("hunter");
    expect(identity).not.toContain("password");
    // A byte count and a short hash, and nothing else.
    expect(identity).toMatch(/^\d+:[0-9a-z]+$/);
    expect(identity.length).toBeLessThan(16);
  });

  it("covers a form-control selection through the same path extractSelection uses", () => {
    const input = document.createElement("input");
    input.value = "Hello world";
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 5);
    const five = selectionIdentity(document);
    input.setSelectionRange(0, 11);
    expect(selectionIdentity(document)).not.toBe(five);
    expect(five).not.toBe("");
  });

  it("never reads a password field, so typing into one produces no identity to ping about", () => {
    const input = document.createElement("input");
    input.type = "password";
    input.value = "hunter2!";
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 8);
    expect(selectionIdentity(document)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// The measurement behind PAGE_EXTRACT_CAP_BYTES
//
// These are the numbers quoted in page-extraction.ts's doc comment and in
// card 118's journal, pinned as assertions so the justification cannot drift
// away from the code silently. Deliberately loose bounds: they say "an
// article fits whole, a shell extracts almost nothing, a huge page is
// capped", which is the CLAIM the cap rests on — not exact byte counts that a
// whitespace tweak would break.
// ---------------------------------------------------------------------------

describe("cap measurement (the evidence for PAGE_EXTRACT_CAP_BYTES)", () => {
  it("a LONG (~2,400-word) article fits inside the cap whole, untruncated", () => {
    // Measured: 13,430 bytes of a 16,000-byte budget. A typical 800-1,500
    // word post is 5-9 KB, i.e. about half of it — the cap is sized so the
    // long tail fits, not so the median just scrapes in.
    const result = extractPageText(parse(ARTICLE_PAGE));
    expect(result.truncated).toBe(false);
    expect(result.bytes).toBeGreaterThan(10_000);
    expect(result.bytes).toBeLessThan(PAGE_EXTRACT_CAP_BYTES);
  });

  it("a nav-heavy shell extracts its content, not its chrome — the heuristics do the work, not the cap", () => {
    const result = extractPageText(parse(navHeavyPage()));
    expect(result.truncated).toBe(false);
    expect(result.bytes).toBeLessThan(1_000);
    expect(result.text).toContain("You have three open items");
    expect(result.text).not.toContain("Footer destination");
    expect(result.text).not.toContain("product catalogue");
  });

  it("a huge page is capped, and the walk that produces it is fast enough to run on a keystroke-adjacent gesture", () => {
    const doc = parse(hugePage());
    const started = performance.now();
    const result = extractPageText(doc);
    const elapsed = performance.now() - started;
    expect(result.truncated).toBe(true);
    // Generous by two orders of magnitude versus what it measures — this is a
    // regression tripwire for an accidentally quadratic walk, not a benchmark.
    expect(elapsed).toBeLessThan(1_000);
  });
});

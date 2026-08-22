// Tests for the two text-shaping rules ./text.ts collapsed three hand-rolled
// copies each into (card 113). Pure functions over plain data, zero platform
// mocks (decisions/30-vitest-test-pyramid.md).
import { describe, expect, it } from "vitest";
import { collapseWhitespace, truncateWithEllipsis } from "./text";

describe("collapseWhitespace", () => {
  it("turns newlines and runs of spaces into single spaces", () => {
    expect(collapseWhitespace("a\n\nb   c\td")).toBe("a b c d");
  });

  it("trims the ends", () => {
    expect(collapseWhitespace("  hello  ")).toBe("hello");
  });

  it("leaves an already-single-line string alone", () => {
    expect(collapseWhitespace("hello there")).toBe("hello there");
  });

  it("collapses whitespace-only text to nothing", () => {
    expect(collapseWhitespace("  \n\t ")).toBe("");
  });
});

describe("truncateWithEllipsis", () => {
  it("leaves text that already fits untouched, ellipsis and all", () => {
    expect(truncateWithEllipsis("hello", 5)).toBe("hello");
    expect(truncateWithEllipsis("", 5)).toBe("");
  });

  it("cuts to max and appends the default ellipsis", () => {
    expect(truncateWithEllipsis("hello world", 5)).toBe("hello…");
  });

  it("trims the cut edge, so the ellipsis never follows a space", () => {
    expect(truncateWithEllipsis("hello  world", 6)).toBe("hello…");
  });

  it("uses the ellipsis it is given — a clipped tool result has to say so", () => {
    expect(truncateWithEllipsis("hello world", 5, "\n… (truncated)")).toBe("hello\n… (truncated)");
  });

  it("bounds the ORIGINAL text, not the result — the ellipsis is allowed to overflow max", () => {
    expect(truncateWithEllipsis("abcdef", 3)).toBe("abc…");
  });
});

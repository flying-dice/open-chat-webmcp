import { describe, it, expect } from "vitest";
import { titleFromMessages, titleFromSummary, normalizeChatTitle, TITLE_MAX_LENGTH } from "./title";
import type { TranscriptEntry } from "./message";
import type { ChatSummary } from "./session";

// Card 102 (decisions/37-i18n-paraglide.md): `titleFromMessages`/
// `titleFromSummary` take the "nothing to derive a title from" fallback as a
// required parameter now, rather than baking in the English `UNTITLED_CHAT`
// constant this file used to import — a plain literal here, since this suite
// tests the domain's DERIVATION logic, not the fallback's wording (which is
// `m.chatTitle_untitled()` at every real call site).
const UNTITLED = "New chat";

function userMsg(content: string): TranscriptEntry {
  return { id: "u1", role: "user", content, createdAt: 0 };
}

function assistantMsg(content: string): TranscriptEntry {
  return { id: "a1", role: "assistant", content, createdAt: 0 };
}

describe("titleFromMessages", () => {
  it("derives the title from the first user message when there is no explicit title", () => {
    expect(titleFromMessages([userMsg("Summarise this page for me")], UNTITLED)).toBe(
      "Summarise this page for me",
    );
  });

  it("an explicit title always wins over the derived one", () => {
    const messages = [userMsg("Summarise this page for me")];
    expect(titleFromMessages(messages, UNTITLED, "My custom name")).toBe("My custom name");
  });

  it("falls back to the untitled fallback when there is no user message yet", () => {
    expect(titleFromMessages([], UNTITLED)).toBe(UNTITLED);
    expect(titleFromMessages([assistantMsg("hello")], UNTITLED)).toBe(UNTITLED);
  });

  it("falls back to the untitled fallback when the first user message is empty/whitespace-only", () => {
    expect(titleFromMessages([userMsg("   ")], UNTITLED)).toBe(UNTITLED);
    expect(titleFromMessages([userMsg("")], UNTITLED)).toBe(UNTITLED);
  });

  it("collapses newlines and runs of whitespace into single spaces", () => {
    expect(titleFromMessages([userMsg("line one\n\n  line two\tline three")], UNTITLED)).toBe(
      "line one line two line three",
    );
  });

  it("truncates a very long first message to TITLE_MAX_LENGTH with an ellipsis", () => {
    const long = "x".repeat(200);
    const title = titleFromMessages([userMsg(long)], UNTITLED);
    expect(title.length).toBe(TITLE_MAX_LENGTH + 1); // + the ellipsis character
    expect(title.endsWith("…")).toBe(true);
    expect(title.startsWith("x".repeat(TITLE_MAX_LENGTH))).toBe(true);
  });

  it("truncates a very long explicit title the same way as a derived one", () => {
    const long = "y".repeat(200);
    const title = titleFromMessages([userMsg("irrelevant")], UNTITLED, long);
    expect(title.length).toBe(TITLE_MAX_LENGTH + 1);
    expect(title.endsWith("…")).toBe(true);
  });

  it("does not truncate a message exactly at the max length", () => {
    const exact = "z".repeat(TITLE_MAX_LENGTH);
    expect(titleFromMessages([userMsg(exact)], UNTITLED)).toBe(exact);
  });

  it("ignores an assistant message that precedes the first user message", () => {
    expect(titleFromMessages([assistantMsg("hi there"), userMsg("real question")], UNTITLED)).toBe(
      "real question",
    );
  });
});

describe("titleFromSummary", () => {
  const base: ChatSummary = {
    id: "c1",
    origin: "https://example.com",
    createdAt: 0,
    updatedAt: 0,
    messageCount: 1,
    toolCallCount: 0,
  };

  it("prefers an explicit summary title over the preview", () => {
    expect(
      titleFromSummary({ ...base, title: "Renamed chat", preview: "first message" }, UNTITLED),
    ).toBe("Renamed chat");
  });

  it("falls back to the preview when there is no explicit title", () => {
    expect(titleFromSummary({ ...base, preview: "first message" }, UNTITLED)).toBe("first message");
  });

  it("falls back to the origin when there is neither a title nor a preview", () => {
    expect(titleFromSummary(base, UNTITLED)).toBe("https://example.com");
  });

  it("falls back to the untitled fallback when title, preview and origin are all empty", () => {
    expect(titleFromSummary({ ...base, origin: "" }, UNTITLED)).toBe(UNTITLED);
  });

  it("truncates a long preview to the given max", () => {
    const preview = "p".repeat(200);
    const title = titleFromSummary({ ...base, preview }, UNTITLED, 10);
    expect(title).toBe(`${"p".repeat(10)}…`);
  });

  it("collapses whitespace in an explicit title the same way as a derived one", () => {
    expect(titleFromSummary({ ...base, title: "line one\n line two" }, UNTITLED)).toBe(
      "line one line two",
    );
  });
});

describe("normalizeChatTitle", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeChatTitle("  My   Chat\nName  ", 100)).toBe("My Chat Name");
  });

  it("returns undefined for an empty or whitespace-only rename (unsets the explicit title)", () => {
    expect(normalizeChatTitle("", 100)).toBeUndefined();
    expect(normalizeChatTitle("   \n\t  ", 100)).toBeUndefined();
  });

  it("caps the stored length at maxStored without adding an ellipsis", () => {
    const long = "a".repeat(50);
    expect(normalizeChatTitle(long, 10)).toBe("a".repeat(10));
  });

  it("leaves a title at or under the cap untouched", () => {
    expect(normalizeChatTitle("short", 10)).toBe("short");
  });
});

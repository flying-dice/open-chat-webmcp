import { describe, it, expect } from "vitest";
import { chatExportFilename, serializeChatMarkdown, type ChatExportEntry } from "./export";
import type { ChatExportLabels, ChatExportMeta } from "./export";

const LABELS: ChatExportLabels = {
  you: "You",
  assistant: "Assistant",
  arguments: "Arguments",
  result: "Result",
  error: "Error",
  origin: "Origin",
  exported: "Exported",
};

const META: ChatExportMeta = {
  title: "Ferret care questions",
  origin: "https://example.com",
  exportedAt: "2026-08-22, 3:00 PM",
};

function userEntry(body: string, timestamp = "t1"): ChatExportEntry {
  return { kind: "message", role: "user", timestamp, body };
}

function assistantEntry(body: string, timestamp = "t2"): ChatExportEntry {
  return { kind: "message", role: "assistant", timestamp, body };
}

describe("serializeChatMarkdown", () => {
  it("renders the title and an origin/exported header", () => {
    const doc = serializeChatMarkdown(META, [], LABELS);
    expect(doc).toContain("# Ferret care questions");
    expect(doc).toContain("- Origin: https://example.com");
    expect(doc).toContain("- Exported: 2026-08-22, 3:00 PM");
  });

  it("renders a user and assistant exchange as headed sections in order", () => {
    const doc = serializeChatMarkdown(
      META,
      [userEntry("What do ferrets eat?", "t1"), assistantEntry("Mostly meat.", "t2")],
      LABELS,
    );
    const userIndex = doc.indexOf("## You — t1");
    const assistantIndex = doc.indexOf("## Assistant — t2");
    expect(userIndex).toBeGreaterThan(-1);
    expect(assistantIndex).toBeGreaterThan(userIndex);
    expect(doc).toContain("What do ferrets eat?");
    expect(doc).toContain("Mostly meat.");
  });

  it("skips a message entry with empty body rather than emitting an empty section", () => {
    const doc = serializeChatMarkdown(
      META,
      [assistantEntry("", "t1"), userEntry("real question", "t2")],
      LABELS,
    );
    expect(doc).not.toContain("## Assistant — t1");
    expect(doc).toContain("## You — t2");
  });

  it("renders no --- separator or sections when every entry was skipped", () => {
    const doc = serializeChatMarkdown(META, [assistantEntry(""), userEntry("   ")], LABELS);
    expect(doc).not.toContain("---");
  });

  it("renders a successful tool call as a heading, fenced JSON args, and a fenced Result block", () => {
    const doc = serializeChatMarkdown(
      META,
      [
        {
          kind: "tool",
          timestamp: "t3",
          name: "get_weather",
          origin: "this page",
          failed: false,
          args: { city: "Paris" },
          body: "70F and sunny",
        },
      ],
      LABELS,
    );
    expect(doc).toContain("### `get_weather` — this page — t3");
    expect(doc).toContain("**Arguments**");
    expect(doc).toContain('```json\n{\n  "city": "Paris"\n}\n```');
    expect(doc).toContain("**Result**");
    expect(doc).toContain("```\n70F and sunny\n```");
    expect(doc).not.toContain("**Error**");
  });

  it("renders a failed tool call under an Error heading instead of Result", () => {
    const doc = serializeChatMarkdown(
      META,
      [
        {
          kind: "tool",
          timestamp: "t4",
          name: "delete_file",
          origin: "server: Files",
          failed: true,
          args: {},
          body: "You denied this call.",
        },
      ],
      LABELS,
    );
    expect(doc).toContain("**Error**");
    expect(doc).toContain("```\nYou denied this call.\n```");
    expect(doc).not.toContain("**Result**");
  });

  it("still renders the Arguments block for a tool call with no result yet, and nothing else", () => {
    const doc = serializeChatMarkdown(
      META,
      [
        {
          kind: "tool",
          timestamp: "t5",
          name: "long_running_call",
          origin: "this page",
          failed: false,
          args: { id: 1 },
          body: "",
        },
      ],
      LABELS,
    );
    expect(doc).toContain("**Arguments**");
    expect(doc).not.toContain("**Result**");
    expect(doc).not.toContain("**Error**");
  });

  it("keeps entries in the exact order given", () => {
    const doc = serializeChatMarkdown(
      META,
      [
        userEntry("first", "t1"),
        {
          kind: "tool",
          timestamp: "t2",
          name: "search",
          origin: "this page",
          failed: false,
          args: {},
          body: "results",
        },
        assistantEntry("second", "t3"),
      ],
      LABELS,
    );
    const i1 = doc.indexOf("first");
    const i2 = doc.indexOf("search");
    const i3 = doc.indexOf("second");
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
  });
});

describe("chatExportFilename", () => {
  it("turns a plain title into a .md filename with hyphens for spaces", () => {
    expect(chatExportFilename("Ferret care questions", "New chat")).toBe(
      "Ferret-care-questions.md",
    );
  });

  it("strips characters no filesystem accepts", () => {
    expect(chatExportFilename('weird: "title" / with * chars?', "New chat")).toBe(
      "weird-title-with-chars.md",
    );
  });

  it("keeps non-Latin scripts as-is", () => {
    expect(chatExportFilename("日本語のタイトル", "New chat")).toBe("日本語のタイトル.md");
  });

  it("falls back to the localized fallback when the title sanitizes to nothing", () => {
    expect(chatExportFilename("???", "New chat")).toBe("New-chat.md");
    expect(chatExportFilename("", "New chat")).toBe("New-chat.md");
  });

  it("falls back to 'chat' as a last resort when even the fallback sanitizes to nothing", () => {
    expect(chatExportFilename("???", "///")).toBe("chat.md");
  });

  it("caps an extremely long title", () => {
    const long = "a".repeat(300);
    const filename = chatExportFilename(long, "New chat");
    expect(filename.length).toBeLessThanOrEqual(83); // 80 + ".md"
    expect(filename.endsWith(".md")).toBe(true);
  });
});

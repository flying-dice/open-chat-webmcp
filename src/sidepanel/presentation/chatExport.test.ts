// Card 116: this file drives the UI seam (src/sidepanel/presentation/
// chatExport.ts) rather than the pure domain serializer it wraps
// (src/domain/chat/export.test.ts already pins the document structure with
// plain fixtures) — what's worth testing here is that the RIGHT locale-aware
// value reaches each slot: a note renders through `noteText`, a tool's
// origin through `originLabel`, and every heading/role label comes from a
// real `m.*()` call rather than English baked in.
import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "../../domain/chat";
import { buildChatExportMarkdown, chatExportFilenameFor } from "./chatExport";
import { noteText } from "./transcriptNote";
import { m } from "../../paraglide/messages.js";

function userMsg(content: string, overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return { id: "u1", role: "user", content, createdAt: 1_700_000_000_000, ...overrides };
}

function toolMsg(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: "t1",
    role: "tool",
    content: "",
    createdAt: 1_700_000_000_000,
    toolName: "get_weather",
    toolArgs: { city: "Paris" },
    toolStatus: "success",
    ...overrides,
  };
}

describe("buildChatExportMarkdown", () => {
  it("titles the document and includes the origin", () => {
    const doc = buildChatExportMarkdown([], "My chat", "https://example.com");
    expect(doc).toContain("# My chat");
    expect(doc).toContain("https://example.com");
  });

  it("renders a user message under the localized 'You' label", () => {
    const doc = buildChatExportMarkdown([userMsg("hello there")], "chat", "https://example.com");
    expect(doc).toContain(`## ${m.chatExport_youLabel()}`);
    expect(doc).toContain("hello there");
  });

  it("renders an assistant message under the localized 'Assistant' label", () => {
    const doc = buildChatExportMarkdown(
      [{ id: "a1", role: "assistant", content: "hi!", createdAt: 0 }],
      "chat",
      "https://example.com",
    );
    expect(doc).toContain(`## ${m.chatExport_assistantLabel()}`);
    expect(doc).toContain("hi!");
  });

  it("resolves an assistant note through noteText — the same words the transcript itself shows", () => {
    const doc = buildChatExportMarkdown(
      [
        {
          id: "a1",
          role: "assistant",
          content: "",
          createdAt: 0,
          note: { kind: "iteration-cap", limit: 5 },
        },
      ],
      "chat",
      "https://example.com",
    );
    expect(doc).toContain(noteText({ kind: "iteration-cap", limit: 5 }));
  });

  it("renders a successful tool call with its own name, args, and result", () => {
    const doc = buildChatExportMarkdown(
      [toolMsg({ content: "It's sunny." })],
      "chat",
      "https://example.com",
    );
    expect(doc).toContain("get_weather");
    expect(doc).toContain('"city": "Paris"');
    expect(doc).toContain("It's sunny.");
    expect(doc).toContain(`**${m.resultHeading()}**`);
  });

  it("resolves a denied tool call's note the same way the transcript renders it, under Error", () => {
    const doc = buildChatExportMarkdown(
      [toolMsg({ toolStatus: "denied", note: { kind: "tool-denied" } })],
      "chat",
      "https://example.com",
    );
    expect(doc).toContain(noteText({ kind: "tool-denied" }));
    expect(doc).toContain(`**${m.errorHeading()}**`);
  });

  it("labels a page-origin tool call with the localized 'this page' wording", () => {
    const doc = buildChatExportMarkdown(
      [toolMsg({ toolOrigin: { kind: "page" } })],
      "chat",
      "https://example.com",
    );
    expect(doc).toContain(m.thisPageLabel());
  });

  it("labels a server-origin tool call with the server's own name", () => {
    const doc = buildChatExportMarkdown(
      [toolMsg({ toolOrigin: { kind: "server", serverId: "s1", serverName: "Files" } })],
      "chat",
      "https://example.com",
    );
    expect(doc).toContain("Files");
  });

  it("falls back to the 'origin unknown' badge wording for a hallucinated tool name", () => {
    const doc = buildChatExportMarkdown(
      [toolMsg({ toolOrigin: undefined })],
      "chat",
      "https://example.com",
    );
    expect(doc).toContain(m.toolCallRow_originUnknownBadge());
  });

  it("renders the pre-card-114 legacy passthrough (prose content, no note) verbatim", () => {
    const doc = buildChatExportMarkdown(
      [
        {
          id: "a1",
          role: "assistant",
          content: "⚠️ Something went wrong ages ago.",
          createdAt: 0,
        },
      ],
      "chat",
      "https://example.com",
    );
    expect(doc).toContain("Something went wrong ages ago.");
  });
});

describe("chatExportFilenameFor", () => {
  it("derives a .md filename from the title", () => {
    expect(chatExportFilenameFor("Ferret care")).toBe("Ferret-care.md");
  });

  it("falls back to the localized untitled wording when the title sanitizes to nothing", () => {
    expect(chatExportFilenameFor("")).toContain(".md");
  });
});

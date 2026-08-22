import { describe, it, expect } from "vitest";
import {
  createChat,
  chatPreview,
  summarizeChat,
  logToolCall,
  completeToolCall,
  MAX_CHAT_PREVIEW_LENGTH,
  MAX_RETAINED_CHATS,
  type ChatSession,
} from "./session";
import type { TranscriptEntry } from "./message";

function userMsg(content: string): TranscriptEntry {
  return { id: "u1", role: "user", content, createdAt: Date.now() };
}

describe("createChat", () => {
  it("builds a brand-new, empty chat for the given origin", () => {
    const chat = createChat("https://example.com");
    expect(chat.origin).toBe("https://example.com");
    expect(chat.messages).toEqual([]);
    expect(chat.toolCalls).toEqual([]);
    expect(chat.selection).toBeUndefined();
    expect(typeof chat.id).toBe("string");
    expect(chat.id.length).toBeGreaterThan(0);
  });

  it("carries an optional selection through unchanged", () => {
    const chat = createChat("https://example.com", { providerId: "p1", model: "m1" });
    expect(chat.selection).toEqual({ providerId: "p1", model: "m1" });
  });

  it("gives every new chat a distinct id", () => {
    const a = createChat("https://example.com");
    const b = createChat("https://example.com");
    expect(a.id).not.toBe(b.id);
  });
});

describe("chatPreview", () => {
  it("is undefined when there is no user message yet", () => {
    expect(chatPreview([])).toBeUndefined();
  });

  it("is undefined when the only user message is empty/whitespace", () => {
    expect(chatPreview([userMsg("   ")])).toBeUndefined();
  });

  it("trims the first user message", () => {
    expect(chatPreview([userMsg("  hello there  ")])).toBe("hello there");
  });

  it("truncates a long first message to MAX_CHAT_PREVIEW_LENGTH with an ellipsis", () => {
    const long = "a".repeat(300);
    const preview = chatPreview([userMsg(long)]);
    expect(preview).toBe(`${"a".repeat(MAX_CHAT_PREVIEW_LENGTH)}…`);
  });

  it("ignores assistant/tool entries and uses the first user entry", () => {
    const messages: TranscriptEntry[] = [
      { id: "a1", role: "assistant", content: "hi", createdAt: 0 },
      userMsg("actual first user message"),
    ];
    expect(chatPreview(messages)).toBe("actual first user message");
  });
});

describe("summarizeChat", () => {
  it("derives a ChatSummary consistent with the session's own fields", () => {
    const chat = createChat("https://example.com");
    chat.messages.push(userMsg("hello"));
    chat.toolCalls.push({
      id: "t1",
      name: "read",
      arguments: {},
      mode: "auto",
      startedAt: Date.now(),
    });
    chat.title = "Renamed";

    const summary = summarizeChat(chat);
    expect(summary).toEqual({
      id: chat.id,
      origin: chat.origin,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messageCount: 1,
      toolCallCount: 1,
      preview: "hello",
      title: "Renamed",
    });
  });

  it("leaves preview and title undefined when there is neither", () => {
    const chat = createChat("https://example.com");
    const summary = summarizeChat(chat);
    expect(summary.preview).toBeUndefined();
    expect(summary.title).toBeUndefined();
  });
});

describe("logToolCall / completeToolCall", () => {
  function freshSession(): ChatSession {
    return createChat("https://example.com");
  }

  it("appends a log entry and returns it", () => {
    const session = freshSession();
    const entry = logToolCall(session, {
      id: "call-1",
      name: "read_page",
      arguments: { selector: "body" },
      mode: "auto",
      origin: { kind: "page" },
    });
    expect(session.toolCalls).toEqual([entry]);
    expect(entry.startedAt).toBeGreaterThan(0);
    expect(entry.endedAt).toBeUndefined();
  });

  it("a denied call is terminal on append — endedAt is set immediately, no completion needed", () => {
    const session = freshSession();
    const entry = logToolCall(session, {
      id: "call-1",
      name: "write_page",
      arguments: {},
      mode: "denied",
    });
    expect(entry.endedAt).toBe(entry.startedAt);
  });

  it("completeToolCall records a success result on the matching entry by id", () => {
    const session = freshSession();
    logToolCall(session, { id: "call-1", name: "read_page", arguments: {}, mode: "auto" });
    completeToolCall(session, "call-1", { result: "page content" });
    expect(session.toolCalls[0]!.result).toBe("page content");
    expect(session.toolCalls[0]!.error).toBeUndefined();
    expect(session.toolCalls[0]!.endedAt).toBeGreaterThan(0);
  });

  it("completeToolCall records an error on the matching entry by id", () => {
    const session = freshSession();
    logToolCall(session, { id: "call-1", name: "read_page", arguments: {}, mode: "auto" });
    completeToolCall(session, "call-1", { error: "boom" });
    expect(session.toolCalls[0]!.error).toBe("boom");
    expect(session.toolCalls[0]!.result).toBeUndefined();
  });

  it("completeToolCall is a no-op for an id that was never logged", () => {
    const session = freshSession();
    expect(() => completeToolCall(session, "does-not-exist", { result: "x" })).not.toThrow();
    expect(session.toolCalls).toEqual([]);
  });
});

describe("retention/preview constants", () => {
  it("keeps a sane, positive retention cap and preview length", () => {
    expect(MAX_RETAINED_CHATS).toBeGreaterThan(0);
    expect(MAX_CHAT_PREVIEW_LENGTH).toBeGreaterThan(0);
  });
});

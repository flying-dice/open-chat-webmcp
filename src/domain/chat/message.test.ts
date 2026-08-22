import { describe, it, expect } from "vitest";
import {
  toModelMessage,
  toModelConversation,
  fenceUntrustedContent,
  userEntry,
  assistantEntry,
  toolEntry,
  UNTRUSTED_CONTENT_START,
  UNTRUSTED_CONTENT_END,
  type TranscriptEntry,
} from "./message";
import type { ToolCall } from "../providers";

const call: ToolCall = { id: "call-1", name: "read_page", arguments: { selector: "body" } };

describe("fenceUntrustedContent", () => {
  it("wraps the content in the untrusted delimiter pair and names the tool", () => {
    const fenced = fenceUntrustedContent("read_page", "page says hello");
    expect(fenced.startsWith(UNTRUSTED_CONTENT_START)).toBe(true);
    expect(fenced.endsWith(UNTRUSTED_CONTENT_END)).toBe(true);
    expect(fenced).toContain("read_page");
    expect(fenced).toContain("page says hello");
  });
});

describe("toModelMessage", () => {
  it("narrows a user entry to role/content only", () => {
    const entry = userEntry("u1", "hello", 0);
    expect(toModelMessage(entry)).toEqual({
      role: "user",
      content: "hello",
      toolCalls: undefined,
      toolCallId: undefined,
      toolName: undefined,
    });
  });

  it("carries toolCalls through on an assistant entry that requested them", () => {
    const entry = assistantEntry("a1", 0);
    entry.content = "let me check";
    entry.toolCalls = [call];
    const msg = toModelMessage(entry);
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("let me check");
    expect(msg.toolCalls).toEqual([call]);
  });

  it("fences a tool entry's content when its snapshot annotation set untrustedContentHint", () => {
    const entry = toolEntry(
      "t1",
      call,
      { mode: "auto", annotations: { untrustedContentHint: true } },
      0,
    );
    entry.content = "raw page text an attacker might control";
    entry.toolStatus = "success";

    const msg = toModelMessage(entry);
    expect(msg.content.startsWith(UNTRUSTED_CONTENT_START)).toBe(true);
    expect(msg.content).toContain("raw page text an attacker might control");
    expect(msg.content).toContain(entry.toolName);

    // The stored entry itself must stay untouched — only the copy sent to
    // the model is fenced.
    expect(entry.content).toBe("raw page text an attacker might control");
  });

  it("does not fence a tool entry whose tool was not annotated untrusted", () => {
    const entry = toolEntry(
      "t1",
      call,
      { mode: "auto", annotations: { untrustedContentHint: false } },
      0,
    );
    entry.content = "trusted result";
    expect(toModelMessage(entry).content).toBe("trusted result");
  });

  it("does not fence a tool entry with no annotations snapshot at all (hallucinated tool)", () => {
    const entry = toolEntry("t1", call, { mode: "auto" }, 0);
    entry.content = "some result";
    expect(toModelMessage(entry).content).toBe("some result");
  });

  it("does not fence an untrusted tool entry whose content is still empty (pending)", () => {
    const entry = toolEntry(
      "t1",
      call,
      { mode: "auto", annotations: { untrustedContentHint: true } },
      0,
    );
    expect(entry.content).toBe("");
    expect(toModelMessage(entry).content).toBe("");
  });

  it("carries toolCallId and toolName through on a tool entry", () => {
    const entry = toolEntry("t1", call, { mode: "approved" }, 0);
    entry.content = "result";
    const msg = toModelMessage(entry);
    expect(msg.toolCallId).toBe(call.id);
    expect(msg.toolName).toBe(call.name);
  });

  it("never leaks UI-only fields (id, createdAt, toolArgs, toolStatus, toolMode, annotation snapshots, actions) onto the model message", () => {
    const entry: TranscriptEntry = {
      id: "t1",
      role: "tool",
      content: "result",
      createdAt: 12345,
      toolName: call.name,
      toolCallId: call.id,
      toolArgs: { selector: "body" },
      toolStatus: "success",
      toolMode: "approved",
      toolAnnotations: { readOnlyHint: true },
      toolOrigin: { kind: "page" },
      toolMcpAnnotations: { title: "Read Page" },
      actions: [{ kind: "retry" }],
    };

    const msg = toModelMessage(entry);
    expect(Object.keys(msg).sort()).toEqual(
      ["role", "content", "toolCalls", "toolCallId", "toolName"].sort(),
    );
    expect((msg as unknown as Record<string, unknown>).id).toBeUndefined();
    expect((msg as unknown as Record<string, unknown>).createdAt).toBeUndefined();
    expect((msg as unknown as Record<string, unknown>).toolArgs).toBeUndefined();
    expect((msg as unknown as Record<string, unknown>).toolStatus).toBeUndefined();
    expect((msg as unknown as Record<string, unknown>).toolMode).toBeUndefined();
    expect((msg as unknown as Record<string, unknown>).toolAnnotations).toBeUndefined();
    expect((msg as unknown as Record<string, unknown>).toolOrigin).toBeUndefined();
    expect((msg as unknown as Record<string, unknown>).toolMcpAnnotations).toBeUndefined();
    expect((msg as unknown as Record<string, unknown>).actions).toBeUndefined();
  });
});

describe("toModelConversation", () => {
  it("prepends a fresh system prompt and narrows every stored entry", () => {
    const entries: TranscriptEntry[] = [userEntry("u1", "hi", 0)];
    const convo = toModelConversation("SYSTEM PROMPT", entries);
    expect(convo[0]).toEqual({ role: "system", content: "SYSTEM PROMPT" });
    expect(convo[1]!.role).toBe("user");
    expect(convo[1]!.content).toBe("hi");
    expect(convo).toHaveLength(2);
  });

  it("fences an untrusted tool result in the conversation sent to the model without mutating the source entries", () => {
    const toolMsg = toolEntry(
      "t1",
      call,
      { mode: "auto", annotations: { untrustedContentHint: true } },
      0,
    );
    toolMsg.content = "attacker-controlled text";
    const entries: TranscriptEntry[] = [userEntry("u1", "check the page", 0), toolMsg];

    const convo = toModelConversation("SYSTEM", entries);
    expect(convo[2]!.content.startsWith(UNTRUSTED_CONTENT_START)).toBe(true);
    expect(entries[1]!.content).toBe("attacker-controlled text");
  });
});

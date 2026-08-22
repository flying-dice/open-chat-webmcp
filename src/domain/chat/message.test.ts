import { describe, it, expect } from "vitest";
import {
  toModelMessage,
  toModelConversation,
  fenceUntrustedContent,
  userEntry,
  assistantEntry,
  toolEntry,
  noteEntry,
  noteForModel,
  UNTRUSTED_CONTENT_START,
  UNTRUSTED_CONTENT_END,
  type TranscriptEntry,
  type TranscriptNote,
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

// ---------------------------------------------------------------------------
// Card 114 (decisions/38-transcript-stores-codes-not-prose.md): a note is a
// KIND plus params in storage, and a sentence only at the two seams that need
// one — the reader's screen (src/sidepanel/presentation/transcriptNote.ts) and
// the model's prompt (`noteForModel` below).
// ---------------------------------------------------------------------------

describe("noteEntry", () => {
  it("stores the kind and NOTHING readable", () => {
    const entry = noteEntry("n1", { kind: "iteration-cap", limit: 8 }, 5);
    expect(entry).toEqual({
      id: "n1",
      role: "assistant",
      content: "",
      createdAt: 5,
      note: { kind: "iteration-cap", limit: 8 },
    });
  });

  it("attaches action chips when there are any, and omits the field entirely when there are none", () => {
    expect(noteEntry("n1", { kind: "no-provider" }, 5, [{ kind: "retry" }]).actions).toEqual([
      { kind: "retry" },
    ]);
    expect("actions" in noteEntry("n2", { kind: "no-provider" }, 5, [])).toBe(false);
    expect("actions" in noteEntry("n3", { kind: "no-provider" }, 5)).toBe(false);
  });

  it("copies the actions array rather than aliasing the caller's", () => {
    const actions = [{ kind: "retry" } as const];
    const entry = noteEntry("n1", { kind: "no-provider" }, 5, actions);
    actions.push({ kind: "retry" });
    expect(entry.actions).toHaveLength(1);
  });
});

describe("noteForModel", () => {
  // One case per kind, so adding a kind without giving the model a sentence
  // is a compile error (the switch is exhaustive) AND a test gap here.
  const KINDS: [TranscriptNote, string][] = [
    [
      { kind: "provider-error", error: { kind: "auth", status: 401, message: "bad key" } },
      "Authentication failed (401): bad key",
    ],
    [{ kind: "iteration-cap", limit: 8 }, "Stopped after 8 tool-call rounds"],
    [{ kind: "no-provider" }, "No model provider is configured"],
    [{ kind: "no-selection" }, "No provider and model are selected"],
    [{ kind: "tool-denied" }, "The user denied this tool call."],
    [{ kind: "tool-unknown", toolName: "made_up" }, `"made_up" isn't in this turn's tool list`],
    [{ kind: "tool-timeout", seconds: 0.05 }, "timed out after 0.05s"],
    [{ kind: "tool-stopped-before" }, "Stopped by the user before this call ran."],
    [{ kind: "tool-stopped" }, "Stopped by the user."],
    [{ kind: "tool-failed" }, "Tool call failed for an unknown reason."],
  ];

  it.each(KINDS)("gives the model a sentence for %o", (note, expected) => {
    expect(noteForModel(note)).toContain(expected);
  });
});

describe("toModelMessage — notes", () => {
  it("expands a note's kind into the sentence the model reads, without ever storing it", () => {
    const entry = noteEntry("n1", { kind: "iteration-cap", limit: 8 }, 0);
    expect(toModelMessage(entry).content).toContain("Stopped after 8 tool-call rounds");
    // The seam is one-way: expanding for the prompt must not write back.
    expect(entry.content).toBe("");
  });

  it("does NOT fence a note on an untrusted-content tool entry — the fence claims a web page wrote the text, and this text is ours", () => {
    const entry = toolEntry(
      "t1",
      call,
      { mode: "denied", annotations: { untrustedContentHint: true } },
      0,
    );
    entry.note = { kind: "tool-denied" };
    const message = toModelMessage(entry);
    expect(message.content).toBe("The user denied this tool call.");
    expect(message.content).not.toContain(UNTRUSTED_CONTENT_START);
  });

  it("LEGACY PASSTHROUGH: an entry with prose and no note is sent exactly as it was recorded", () => {
    // Pre-release posture (decisions/38): the write path changed, nothing was
    // converted. A chat recorded before card 114 keeps its embedded English
    // until it is deleted or evicted.
    const legacy = assistantEntry("a1", 0);
    legacy.content = "⚠️ Stopped after 8 tool-call rounds without a final answer.";
    expect(toModelMessage(legacy).content).toBe(legacy.content);
    expect(legacy.note).toBeUndefined();
  });
});

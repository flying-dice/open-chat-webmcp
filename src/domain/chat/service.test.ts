import { describe, it, expect, vi } from "vitest";
import { createChatService, type ChatServiceDeps } from "./service";
import { createChat, type ChatSession } from "./session";
import { userEntry } from "./message";
import type { ChatSaveOptions, ChatStore, ResolvedTabChat } from "./store";
import type { ApprovalDecision, ModelGateway, PageContext } from "./ports";
import type { ApprovalPolicyGate } from "../settings";
import type { ChatParams, ChatStreamEvent, ToolCall } from "../providers";
import type { MergedTool, ToolOrigin } from "../tools";

// ---------------------------------------------------------------------------
// Shared fakes
// ---------------------------------------------------------------------------

const page: PageContext = { tabId: 1, title: "Example Page", origin: "https://example.com" };
const originLabel = (origin: ToolOrigin): string => (origin.kind === "page" ? "this page" : origin.serverName);

/** Never lets anything auto-run — every test that doesn't care about the approval outcome uses this. */
const denyPolicy: ApprovalPolicyGate = { mayAutoRun: async () => false };

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function doneEvent(): ChatStreamEvent {
  return { type: "done", message: { role: "assistant", content: "" }, stats: {} };
}

function scriptedGateway(rounds: ChatStreamEvent[][]): ModelGateway & { requests: ChatParams[] } {
  const requests: ChatParams[] = [];
  let round = 0;
  return {
    requests,
    async *chat(params) {
      requests.push(params);
      const events = rounds[round] ?? [];
      round += 1;
      for (const event of events) yield event;
    },
  };
}

function makeTool(opts: {
  name: string;
  readOnlyHint?: boolean;
  call?: MergedTool["call"];
}): MergedTool {
  return {
    name: opts.name,
    description: `${opts.name} tool`,
    annotations: { readOnlyHint: opts.readOnlyHint ?? false, untrustedContentHint: false },
    origin: { kind: "page" },
    call: opts.call ?? (async () => ({ ok: true, result: "ok" })),
  };
}

/**
 * A fake ChatStore that behaves like real persistence would for the purposes
 * of these tests: `save`/`getChat` round-trip through a deep clone, so a
 * value read back is structurally equal but NEVER the same object reference
 * as what was saved. This is deliberate — it is what makes the live-session
 * re-attachment tests below meaningful: if ChatService ever stopped
 * consulting its in-memory `liveSessions` map and just trusted whatever
 * storage handed back, the test would catch it because the object identity
 * would differ.
 */
function createFakeStore(): ChatStore & {
  chats: Map<string, ChatSession>;
  pointers: Map<number, { chatId: string; origin: string }>;
  saveCalls: { id: string; opts: ChatSaveOptions | undefined }[];
} {
  const chats = new Map<string, ChatSession>();
  const pointers = new Map<number, { chatId: string; origin: string }>();
  const saveCalls: { id: string; opts: ChatSaveOptions | undefined }[] = [];

  function clone(session: ChatSession): ChatSession {
    return JSON.parse(JSON.stringify(session)) as ChatSession;
  }

  return {
    chats,
    pointers,
    saveCalls,
    async getChat(chatId) {
      const found = chats.get(chatId);
      return found ? clone(found) : undefined;
    },
    async getOrCreateChatForTab(tabId, currentOrigin): Promise<ResolvedTabChat> {
      const ptr = pointers.get(tabId);
      if (ptr && ptr.origin === currentOrigin && chats.has(ptr.chatId)) {
        return { chat: clone(chats.get(ptr.chatId)!), resolved: true };
      }
      return { chat: createChat(currentOrigin), resolved: false };
    },
    async setCurrentChatForTab(tabId, chatId, tabOrigin) {
      pointers.set(tabId, { chatId, origin: tabOrigin });
    },
    async save(session, opts) {
      saveCalls.push({ id: session.id, opts });
      chats.set(session.id, clone(session));
    },
    async flush() {},
    async flushAll() {},
    async deleteChat(chatId) {
      chats.delete(chatId);
    },
    async clearAllChats() {
      chats.clear();
    },
    async listChatSummaries() {
      return [];
    },
  };
}

function makeService(overrides: Partial<ChatServiceDeps> = {}) {
  const store = createFakeStore();
  const service = createChatService({
    store,
    policy: denyPolicy,
    originLabel,
    toolCallTimeoutMs: 1000,
    ...overrides,
  });
  return { service, store };
}

// ---------------------------------------------------------------------------
// Tab sync / navigation policy
// ---------------------------------------------------------------------------

describe("ChatService.syncToTab", () => {
  it("creates a fresh chat for a tab with no stored pointer and records the pointer", async () => {
    const { service, store } = makeService();
    await service.syncToTab(1, "https://example.com");

    expect(service.current()?.origin).toBe("https://example.com");
    expect(service.activeTabId()).toBe(1);
    expect(service.activeTabOrigin()).toBe("https://example.com");
    expect(store.pointers.get(1)).toEqual({ chatId: service.current()!.id, origin: "https://example.com" });
  });
});

describe("ChatService.applyNavigation", () => {
  it("is a no-op for a same-origin navigation", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://example.com");
    const before = service.current();

    await service.applyNavigation(1, "https://example.com");

    expect(service.current()).toBe(before);
  });

  it("retires the current chat and starts a fresh one on a real cross-origin navigation", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const oldChat = service.current()!;

    await service.applyNavigation(1, "https://b.example.com");

    const newChat = service.current()!;
    expect(newChat.id).not.toBe(oldChat.id);
    expect(newChat.origin).toBe("https://b.example.com");
    expect(service.activeTabOrigin()).toBe("https://b.example.com");
  });

  it("ignores a navigation event for a tab that is no longer the one this service is pointed at", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const before = service.current();

    await service.applyNavigation(999, "https://other.example.com");

    expect(service.current()).toBe(before);
    expect(service.activeTabOrigin()).toBe("https://a.example.com");
  });

  it("is a no-op when no chat has been loaded yet", async () => {
    const { service } = makeService();
    await expect(service.applyNavigation(1, "https://example.com")).resolves.toBeUndefined();
    expect(service.current()).toBeUndefined();
  });

  it("measures a later navigation against the TAB's origin, not a cross-origin chat opened from History", async () => {
    const { service, store } = makeService();
    await service.syncToTab(1, "https://a.example.com");

    const otherChat = createChat("https://other.example.com");
    otherChat.messages.push(userEntry("u1", "hi", Date.now()));
    await store.save(otherChat, { immediate: true });

    expect(await service.openChat(otherChat.id)).toBe(true);
    expect(service.current()!.id).toBe(otherChat.id);
    // Opening a cross-origin chat from History does NOT change the tab's
    // recorded origin (decision 13) — a real navigation must still be
    // measured against the tab's actual history.
    expect(service.activeTabOrigin()).toBe("https://a.example.com");

    // A "navigation" back to the tab's own origin is therefore a same-origin
    // no-op, even though it differs from the currently open chat's origin.
    await service.applyNavigation(1, "https://a.example.com");
    expect(service.current()!.id).toBe(otherChat.id);

    // A real navigation away DOES retire it.
    await service.applyNavigation(1, "https://different.example.com");
    expect(service.current()!.id).not.toBe(otherChat.id);
  });
});

describe("ChatService.startNewChat", () => {
  it("carries the previous chat's selection and its explicit flag over to the fresh chat", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    await service.setSelection(1, { providerId: "ollama", model: "llama3" }, true);

    await service.startNewChat("https://a.example.com");

    const fresh = service.current()!;
    expect(fresh.selection).toEqual({ providerId: "ollama", model: "llama3" });
    expect(fresh.selectionExplicit).toBe(true);
  });

  it("is a no-op when no tab is loaded", async () => {
    const { service } = makeService();
    await expect(service.startNewChat("https://example.com")).resolves.toBeUndefined();
    expect(service.current()).toBeUndefined();
  });
});

describe("ChatService.discardIfDeleted", () => {
  it("replaces the current chat with a fresh one when it is the one deleted", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const chat = service.current()!;

    await service.discardIfDeleted(chat.id);

    expect(service.current()!.id).not.toBe(chat.id);
  });

  it("is a no-op for any other chat id", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const chat = service.current()!;

    await service.discardIfDeleted("some-other-chat-id");

    expect(service.current()).toBe(chat);
  });
});

// ---------------------------------------------------------------------------
// Selection + rename
// ---------------------------------------------------------------------------

describe("ChatService selection", () => {
  it("getSelection/setSelection are scoped to the tab they were set on", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");

    expect(service.getSelection(1)).toBeUndefined();
    expect(await service.setSelection(1, { providerId: "p", model: "m" }, false)).toBe(true);

    expect(service.getSelection(1)).toEqual({ selection: { providerId: "p", model: "m" }, explicit: false });
    expect(service.getSelection(999)).toBeUndefined();
  });

  it("setSelection returns false when no chat is loaded for that tab", async () => {
    const { service } = makeService();
    expect(await service.setSelection(1, { providerId: "p", model: "m" }, true)).toBe(false);
  });
});

describe("ChatService.renameCurrent", () => {
  it("normalises whitespace and persists immediately WITHOUT stamping updatedAt (touch:false)", async () => {
    const { service, store } = makeService();
    await service.syncToTab(1, "https://a.example.com");

    await service.renameCurrent("  My   Chat  Name  ");

    expect(service.current()!.title).toBe("My Chat Name");
    const lastSave = store.saveCalls.at(-1)!;
    expect(lastSave.opts).toEqual({ immediate: true, touch: false });
  });

  it("an empty/whitespace-only rename unsets the title, reverting to the derived one", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    await service.renameCurrent("Named");
    expect(service.current()!.title).toBe("Named");

    await service.renameCurrent("   ");
    expect(service.current()!.title).toBeUndefined();
  });

  it("is a no-op when no chat is loaded", async () => {
    const { service } = makeService();
    await expect(service.renameCurrent("x")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Transcript mutators
// ---------------------------------------------------------------------------

describe("ChatService transcript mutators", () => {
  it("addUserMessage returns '' and does nothing when no chat is loaded yet", () => {
    const { service } = makeService();
    expect(service.addUserMessage("too early")).toBe("");
  });

  it("addUserMessage appends to the current chat and persists immediately", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const id = service.addUserMessage("hello");
    expect(id).not.toBe("");
    expect(service.current()!.messages).toEqual([expect.objectContaining({ id, role: "user", content: "hello" })]);
  });

  it("beginAssistantMessage / appendAssistantDelta / endAssistantMessage build up a streamed reply", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const id = service.beginAssistantMessage();
    service.appendAssistantDelta(id, "Hel");
    service.appendAssistantDelta(id, "lo");
    service.endAssistantMessage(id);
    expect(service.current()!.messages.find((m) => m.id === id)?.content).toBe("Hello");
  });

  it("addToolCall / updateToolCallResult mirror the SAME call into both the transcript and the tool-call log", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const call: ToolCall = { id: "call-1", name: "read", arguments: { x: 1 } };

    const id = service.addToolCall(call, { mode: "auto" });
    service.updateToolCallResult(id, { status: "success", content: "result text" });

    const chat = service.current()!;
    expect(chat.messages.find((m) => m.id === id)).toMatchObject({
      toolStatus: "success",
      content: "result text",
    });
    expect(chat.toolCalls).toEqual([
      expect.objectContaining({ id: "call-1", name: "read", mode: "auto", result: "result text" }),
    ]);
  });

  it("addAssistantNote appends a note with optional action chips", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const id = service.addAssistantNote("Something went wrong", [{ kind: "retry" }]);
    const entry = service.current()!.messages.find((m) => m.id === id);
    expect(entry?.content).toBe("Something went wrong");
    expect(entry?.actions).toEqual([{ kind: "retry" }]);
  });
});

// ---------------------------------------------------------------------------
// runTurn integration: auto-run + call-log mirroring + second round
// ---------------------------------------------------------------------------

describe("ChatService.runTurn — auto-run tool call end to end", () => {
  it("mirrors an auto-run tool call into the transcript AND the chat's tool-call log, then gives the model a second round", async () => {
    const { service } = makeService({ policy: { mayAutoRun: async (tool) => tool?.annotations.readOnlyHint === true } });
    await service.syncToTab(1, "https://example.com");

    const readTool = makeTool({
      name: "get_title",
      readOnlyHint: true,
      call: async () => ({ ok: true, result: "Example Domain" }),
    });
    const gateway = scriptedGateway([
      [{ type: "tool-calls", toolCalls: [{ id: "call-1", name: "get_title", arguments: {} }] }, doneEvent()],
      [{ type: "content", delta: "It's Example Domain" }, doneEvent()],
    ]);

    await service.runTurn("what's the title?", {
      model: gateway,
      modelId: "m",
      tools: { toolsForTurn: async () => [readTool] },
      approvals: vi.fn(async () => "denied" as ApprovalDecision),
      page,
      attachTools: true,
    });

    const chat = service.current()!;
    expect(chat.messages.find((m) => m.role === "tool")).toMatchObject({
      toolStatus: "success",
      content: "Example Domain",
    });
    expect(chat.toolCalls).toEqual([
      expect.objectContaining({ name: "get_title", mode: "auto", result: "Example Domain" }),
    ]);
    expect(gateway.requests).toHaveLength(2);
    expect(chat.messages.filter((m) => m.role === "assistant").at(-1)?.content).toBe("It's Example Domain");
  });
});

// ---------------------------------------------------------------------------
// 9. Mid-turn tab switch does not redirect a running turn's writes
// ---------------------------------------------------------------------------

describe("ChatService.runTurn — mid-turn tab switch", () => {
  it("does not redirect a running turn's writes when the visible chat changes mid-turn", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const chatA = service.current()!;

    const gate = deferred();
    const reachedGate = deferred();
    const gateway: ModelGateway = {
      async *chat() {
        yield { type: "content", delta: "Hello " };
        reachedGate.resolve();
        await gate.promise;
        yield { type: "content", delta: "World" };
        yield doneEvent();
      },
    };

    const turnPromise = service.runTurn("hi", {
      model: gateway,
      modelId: "m",
      tools: { toolsForTurn: async () => [] },
      approvals: vi.fn(async () => "denied" as ApprovalDecision),
      page,
      attachTools: false,
    });

    await reachedGate.promise;
    expect(chatA.messages.at(-1)?.content).toBe("Hello ");

    // The user switches tabs while the turn above is still running.
    await service.syncToTab(2, "https://b.example.com");
    const chatB = service.current()!;
    expect(chatB.id).not.toBe(chatA.id);

    gate.resolve();
    await turnPromise;

    expect(chatA.messages.at(-1)?.content).toBe("Hello World");
    expect(chatB.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
    expect(service.current()).toBe(chatB); // the turn never redirected the view back to A
  });
});

// ---------------------------------------------------------------------------
// 10. Re-attaching to a chat with a turn in flight
// ---------------------------------------------------------------------------

describe("ChatService.runTurn — re-attaching to a live turn", () => {
  it("re-attaches to the SAME in-memory session object when switching back mid-turn, not a fresh storage read", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const chatA = service.current()!;

    const gate = deferred();
    const reachedGate = deferred();
    const gateway: ModelGateway = {
      async *chat() {
        yield { type: "content", delta: "partial" };
        reachedGate.resolve();
        await gate.promise;
        yield doneEvent();
      },
    };

    const turnPromise = service.runTurn("hi", {
      model: gateway,
      modelId: "m",
      tools: { toolsForTurn: async () => [] },
      approvals: vi.fn(async () => "denied" as ApprovalDecision),
      page,
      attachTools: false,
    });

    await reachedGate.promise;
    expect(service.isTurnActive(chatA.id)).toBe(true);

    await service.syncToTab(2, "https://b.example.com");
    expect(service.current()!.id).not.toBe(chatA.id);

    await service.syncToTab(1, "https://a.example.com");
    // The fake store would hand back a structurally-equal but DIFFERENT
    // object here (see createFakeStore's doc comment) — this assertion only
    // passes if syncToTab actually consulted the live-session registry.
    expect(service.current()).toBe(chatA);

    gate.resolve();
    await turnPromise;
    expect(service.isTurnActive(chatA.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stop wiring
// ---------------------------------------------------------------------------

describe("ChatService.requestStop", () => {
  it("aborts the signal threaded into the in-flight turn's model request", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const chat = service.current()!;

    let capturedSignal: AbortSignal | undefined;
    const gate = deferred();
    const reachedGate = deferred();
    const gateway: ModelGateway = {
      async *chat(params) {
        capturedSignal = params.signal;
        yield { type: "content", delta: "partial" };
        reachedGate.resolve();
        await gate.promise;
        yield doneEvent();
      },
    };

    expect(service.isTurnActive(chat.id)).toBe(false);
    const turnPromise = service.runTurn("hi", {
      model: gateway,
      modelId: "m",
      tools: { toolsForTurn: async () => [] },
      approvals: vi.fn(async () => "denied" as ApprovalDecision),
      page,
      attachTools: false,
    });

    await reachedGate.promise;
    expect(service.isTurnActive(chat.id)).toBe(true);
    expect(capturedSignal?.aborted).toBe(false);

    service.requestStop(chat.id);
    expect(capturedSignal?.aborted).toBe(true);

    gate.resolve();
    await turnPromise;
    expect(service.isTurnActive(chat.id)).toBe(false);
  });

  it("is a no-op for a chat with no turn in flight", () => {
    const { service } = makeService();
    expect(() => service.requestStop("no-such-chat")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Diagnostic snapshot
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Chaos: unhappy paths the suites above don't cover (card 85,
// .claude/skills/chaos-monkey/SKILL.md) — message races between surfaces.
// ---------------------------------------------------------------------------

describe("chaos: a second turn starting for a chat that already has one in flight", () => {
  // KNOWN BUG (journalled on card 85): `runTurn`'s `finally` block
  // unconditionally deletes `liveSessions`/`stopHandlers` for the chat id it
  // captured (./service.ts), with no way to tell "the registration I set up"
  // from "whatever is registered now". Two turns racing for the SAME chat
  // (e.g. a doubled-up "send" click, or a retry fired before the first
  // request settled) is never guarded against anywhere in this port, so the
  // FIRST turn finishing clears the registration out from under the SECOND
  // one, which is still genuinely streaming — `isTurnActive` then reports
  // `false` and `requestStop` becomes a silent no-op for a turn that is very
  // much still running. Fixing this (e.g. a per-registration token, or
  // refusing a second `runTurn` for a chat that already has one active) is
  // for the improvement sprint — this test asserts the CORRECT behaviour and
  // is expected to fail against the current implementation.
  it.fails("keeps reporting the chat as turn-active while the second turn is still streaming", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const chat = service.current()!;

    const gate1 = deferred();
    const reachedGate1 = deferred();
    const gate2 = deferred();
    const reachedGate2 = deferred();
    let round = 0;
    const gateway: ModelGateway = {
      async *chat() {
        round += 1;
        if (round === 1) {
          yield { type: "content", delta: "first " };
          reachedGate1.resolve();
          await gate1.promise;
          yield doneEvent();
        } else {
          yield { type: "content", delta: "second " };
          reachedGate2.resolve();
          await gate2.promise;
          yield doneEvent();
        }
      },
    };

    const turn1 = service.runTurn("go", {
      model: gateway,
      modelId: "m",
      tools: { toolsForTurn: async () => [] },
      approvals: vi.fn(async () => "denied" as ApprovalDecision),
      page,
      attachTools: false,
    });
    await reachedGate1.promise;
    expect(service.isTurnActive(chat.id)).toBe(true);

    // Nothing in the port stops a caller from starting a SECOND turn for the
    // same still-in-flight chat (e.g. two racing "send" clicks, or a retry
    // fired before the first request settled). `runTurn` re-captures
    // `session` (the same live object) and re-registers the stop handler.
    const turn2 = service.runTurn("go again", {
      model: gateway,
      modelId: "m",
      tools: { toolsForTurn: async () => [] },
      approvals: vi.fn(async () => "denied" as ApprovalDecision),
      page,
      attachTools: false,
    });
    await reachedGate2.promise;

    // Let the FIRST turn finish while the second is still streaming.
    gate1.resolve();
    await turn1;

    // CORRECT behaviour: turn2 is still genuinely in flight for this chat.
    expect(service.isTurnActive(chat.id)).toBe(true);

    gate2.resolve();
    await turn2;
    expect(chat.messages.filter((m) => m.role === "assistant").map((m) => m.content)).toEqual([
      "first ",
      "second ",
    ]);
  });
});

describe("chaos: acting on a chat mid-turn from elsewhere", () => {
  it("openChat re-attaches the live, still-streaming session even if it was concurrently deleted from storage", async () => {
    const { service, store } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const chat = service.current()!;

    const gate = deferred();
    const reachedGate = deferred();
    const gateway: ModelGateway = {
      async *chat() {
        yield { type: "content", delta: "partial" };
        reachedGate.resolve();
        await gate.promise;
        yield doneEvent();
      },
    };
    const turnPromise = service.runTurn("hi", {
      model: gateway,
      modelId: "m",
      tools: { toolsForTurn: async () => [] },
      approvals: vi.fn(async () => "denied" as ApprovalDecision),
      page,
      attachTools: false,
    });
    await reachedGate.promise;

    // The user deletes this chat from History (or it's evicted) WHILE it is
    // still streaming — the store no longer has it, but the turn's own
    // in-memory session is still live.
    await store.deleteChat(chat.id);
    await service.syncToTab(2, "https://b.example.com"); // look elsewhere first

    expect(await service.openChat(chat.id)).toBe(true);
    expect(service.current()).toBe(chat); // re-attached to the SAME live object, not a 404

    gate.resolve();
    await turnPromise;
  });

  it("discardIfDeleted starting a fresh chat does not orphan a turn still writing to the old one", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const chat = service.current()!;

    const gate = deferred();
    const reachedGate = deferred();
    const gateway: ModelGateway = {
      async *chat() {
        yield { type: "content", delta: "still " };
        reachedGate.resolve();
        await gate.promise;
        yield { type: "content", delta: "writing" };
        yield doneEvent();
      },
    };
    const turnPromise = service.runTurn("hi", {
      model: gateway,
      modelId: "m",
      tools: { toolsForTurn: async () => [] },
      approvals: vi.fn(async () => "denied" as ApprovalDecision),
      page,
      attachTools: false,
    });
    await reachedGate.promise;

    // "Don't resurrect a chat the user just deleted" fires for the chat this
    // tab is CURRENTLY showing — which, mid-turn, is still `chat`.
    await service.discardIfDeleted(chat.id);
    expect(service.current()!.id).not.toBe(chat.id);

    gate.resolve();
    await turnPromise;
    // The turn kept writing to its captured `target`, unaffected by the
    // panel swapping to a fresh chat underneath it.
    expect(chat.messages.filter((m) => m.role === "assistant").at(-1)?.content).toBe("still writing");
    expect(service.isTurnActive(chat.id)).toBe(false);
  });
});

describe("chaos: duplicate delivery / no-op replays", () => {
  it("syncToTab delivered twice in a row (e.g. a duplicated onActivated event) reattaches the same persisted chat, not a fresh one", async () => {
    const { service, store } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    service.addUserMessage("hello"); // persists immediately — see ChatService's transcript-mutator note
    const first = service.current();

    await service.syncToTab(1, "https://a.example.com");

    // No turn is in flight, so the second sync is a fresh storage read (see
    // createFakeStore's doc comment) rather than the SAME object reference —
    // that reattachment is reserved for a chat with a live turn. What must
    // stay stable is the CHAT identity and its content: the same id, the one
    // message, and exactly one tab pointer — not a second, spuriously
    // recreated chat.
    expect(service.current()!.id).toBe(first!.id);
    expect(service.current()!.messages).toHaveLength(1);
    expect(store.pointers.size).toBe(1);
    expect(store.chats.size).toBe(1);
  });

  it("discardIfDeleted delivered twice for the same id only starts one fresh chat", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const chat = service.current()!;

    await service.discardIfDeleted(chat.id);
    const replacement = service.current()!;
    await service.discardIfDeleted(chat.id); // e.g. a duplicated storage.onChanged / message delivery

    expect(service.current()).toBe(replacement); // second delivery is a no-op, not a second reset
  });
});

describe("ChatService.snapshot", () => {
  it("reports ids and counts only, never message text or tool arguments", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    service.addUserMessage("this is secret conversation content");

    const snap = service.snapshot();
    expect(snap.chatId).toBe(service.current()!.id);
    expect(snap.messageCount).toBe(1);
    expect(snap.toolCallCount).toBe(0);
    expect(snap.liveSessionIds).toEqual([]);
    expect(JSON.stringify(snap)).not.toContain("secret conversation content");
  });
});

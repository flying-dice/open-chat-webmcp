import { describe, it, expect, vi } from "vitest";
import { createChatService, type ChatServiceDeps, type RunTurnRequest } from "./service";
import type { PageContextSnapshot } from "./page-context";
import { createChat, type ChatSession } from "./session";
import { userEntry } from "./message";
import { fail, ok } from "../result";
import type { Result } from "../result";
import { StorageError } from "../storage";
import type { ChatSaveOptions, ChatStore, ResolvedTabChat } from "./store";
import type { ApprovalDecision, ModelGateway, PageContext } from "./ports";
import type { ApprovalPolicyGate } from "../settings";
import type { ChatParams, ChatStreamEvent, ToolCall } from "../providers";
import type { MergedTool, ToolOrigin } from "../tools";

// ---------------------------------------------------------------------------
// Shared fakes
// ---------------------------------------------------------------------------

const page: PageContext = { tabId: 1, title: "Example Page", origin: "https://example.com" };
const originLabel = (origin: ToolOrigin): string =>
  origin.kind === "page" ? "this page" : origin.serverName;

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
 * Errors this fake should hand back instead of answering, keyed by method
 * name — how the "the store did not answer" tests below (card 92) are set
 * up without a second, divergent fake just for the unhappy path. A test
 * flips one of these mid-scenario (`store.failures.getChat = boom`) once it
 * has set up whatever state it wants the fake to have BEFORE the failure.
 */
type FakeChatStoreFailures = Partial<Record<keyof ChatStore, StorageError>>;

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
  failures: FakeChatStoreFailures;
} {
  const chats = new Map<string, ChatSession>();
  const pointers = new Map<number, { chatId: string; origin: string }>();
  const saveCalls: { id: string; opts: ChatSaveOptions | undefined }[] = [];
  const failures: FakeChatStoreFailures = {};

  function clone(session: ChatSession): ChatSession {
    return JSON.parse(JSON.stringify(session)) as ChatSession;
  }

  return {
    chats,
    pointers,
    saveCalls,
    failures,
    async getChat(chatId) {
      if (failures.getChat) return fail(failures.getChat);
      const found = chats.get(chatId);
      return ok(found ? clone(found) : undefined);
    },
    async getOrCreateChatForTab(
      tabId,
      currentOrigin,
    ): Promise<Result<ResolvedTabChat, StorageError>> {
      if (failures.getOrCreateChatForTab) return fail(failures.getOrCreateChatForTab);
      const ptr = pointers.get(tabId);
      if (ptr && ptr.origin === currentOrigin && chats.has(ptr.chatId)) {
        const resolved: ResolvedTabChat = { chat: clone(chats.get(ptr.chatId)!), resolved: true };
        return ok(resolved);
      }
      const fresh: ResolvedTabChat = { chat: createChat(currentOrigin), resolved: false };
      return ok(fresh);
    },
    async setCurrentChatForTab(tabId, chatId, tabOrigin) {
      if (failures.setCurrentChatForTab) return fail(failures.setCurrentChatForTab);
      pointers.set(tabId, { chatId, origin: tabOrigin });
      return ok();
    },
    async save(session, opts) {
      saveCalls.push({ id: session.id, opts });
      if (failures.save) return fail(failures.save);
      chats.set(session.id, clone(session));
      return ok();
    },
    async flush() {
      return ok();
    },
    async flushAll() {
      return ok();
    },
    async deleteChat(chatId) {
      chats.delete(chatId);
      return ok();
    },
    async clearAllChats() {
      chats.clear();
      return ok();
    },
    async listChatSummaries() {
      return ok([]);
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
    expect(store.pointers.get(1)).toEqual({
      chatId: service.current()!.id,
      origin: "https://example.com",
    });
  });

  // Card 92/95 (decisions/34-errors-as-values.md): `syncToTab` is one of the
  // two methods that deliberately KEEP a `Promise<void>` signature — nobody
  // asked for the swap (it is a `chrome.tabs` event), so there is no caller
  // to hand a failure to and the recovery lives here. `reportStorageFailure`
  // is where it goes, and this test is what keeps it from going silent.
  it("does NOT adopt a fabricated empty chat when the store read fails, and reports through reportStorageFailure", async () => {
    const reportStorageFailure = vi.fn();
    const { service, store } = makeService({ reportStorageFailure });
    await service.syncToTab(1, "https://a.example.com");
    const before = service.current();

    const boom = new StorageError("Unavailable", "the store did not answer");
    store.failures.getOrCreateChatForTab = boom;
    await service.syncToTab(2, "https://b.example.com");

    // The conversation on screen is untouched — an unreadable store is NOT
    // the same fact as "this tab has no chat", and swapping in a blank
    // transcript would show the user history their chat isn't actually gone
    // from.
    expect(service.current()).toBe(before);
    expect(reportStorageFailure).toHaveBeenCalledExactlyOnceWith({
      kind: "failed",
      operation: "tab-sync-read",
      chatId: undefined,
      tabId: 2,
      error: boom,
    });
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

    expect(await service.openChat(otherChat.id)).toEqual([true, undefined]);
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
    await expect(service.startNewChat("https://example.com")).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(service.current()).toBeUndefined();
  });

  // Card 95: `startNewChat` writes the tab pointer BEFORE it swaps the
  // visible chat, which is the whole reason its typed failure is worth
  // anything — a caller told "that did not save" must not already be looking
  // at the new chat with the old one retired off screen.
  it("returns the write failure and leaves the CURRENT chat on screen when the tab pointer cannot be written", async () => {
    const reportStorageFailure = vi.fn();
    const { service, store } = makeService({ reportStorageFailure });
    await service.syncToTab(1, "https://a.example.com");
    const before = service.current();

    const boom = new StorageError("Unavailable", "the store did not answer");
    store.failures.setCurrentChatForTab = boom;
    const [, err] = await service.startNewChat("https://a.example.com");

    expect(err).toBe(boom);
    expect(service.current()).toBe(before);
    // Returned, NOT reported: this one has a caller (card 95's posture 1).
    expect(reportStorageFailure).not.toHaveBeenCalled();
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

  it("hands back startNewChat's write failure rather than swallowing it (card 95)", async () => {
    const { service, store } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const chat = service.current()!;

    const boom = new StorageError("Unavailable", "the store did not answer");
    store.failures.setCurrentChatForTab = boom;
    const [, err] = await service.discardIfDeleted(chat.id);

    expect(err).toBe(boom);
    // The deleted chat is still what this tab shows: the caller (History)
    // says so rather than the panel silently pretending it moved on.
    expect(service.current()).toBe(chat);
  });
});

// Card 95: an EVENT-driven method absorbs what a user-driven one returns.
// `applyNavigation` runs off a `chrome.tabs` update, so its inner
// `startNewChat` failure has no caller to reach — it must reach the report
// instead, and the tab must not be left showing a chat for the old origin
// with no explanation anywhere.
describe("ChatService.applyNavigation — storage failure", () => {
  it("reports the failed pointer write and keeps the previous chat rather than returning it", async () => {
    const reportStorageFailure = vi.fn();
    const { service, store } = makeService({ reportStorageFailure });
    await service.syncToTab(1, "https://a.example.com");
    const before = service.current();

    const boom = new StorageError("Unavailable", "the store did not answer");
    store.failures.setCurrentChatForTab = boom;
    await expect(service.applyNavigation(1, "https://b.example.com")).resolves.toBeUndefined();

    expect(service.current()).toBe(before);
    expect(reportStorageFailure).toHaveBeenCalledExactlyOnceWith({
      kind: "failed",
      operation: "navigation-retry",
      chatId: undefined,
      tabId: 1,
      error: boom,
    });
  });
});

// Card 95 (decisions/34-errors-as-values.md): `openChat` returns
// `Result<boolean, StorageError>`, and the three outcomes it can now express
// are exactly the three a History view needs to tell apart — opened, not
// there any more, and "the store did not answer". Card 92 collapsed the last
// two into `false` because the signature had nowhere else to put them.
describe("ChatService.openChat — storage failure", () => {
  it("returns the read failure, leaves the current chat untouched, and does NOT report it (the caller was told)", async () => {
    const reportStorageFailure = vi.fn();
    const { service, store } = makeService({ reportStorageFailure });
    await service.syncToTab(1, "https://a.example.com");
    const before = service.current();

    const boom = new StorageError("Unavailable", "the store did not answer");
    store.failures.getChat = boom;

    const [opened, err] = await service.openChat("some-other-chat-id");
    expect(opened).toBeUndefined();
    expect(err).toBe(boom);
    expect(service.current()).toBe(before);
    expect(reportStorageFailure).not.toHaveBeenCalled();
  });

  it("distinguishes a chat that is simply gone (ok(false)) from a store that did not answer", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");

    await expect(service.openChat("never-existed")).resolves.toEqual([false, undefined]);
  });

  it("does not swap the visible chat when the tab pointer write fails", async () => {
    const { service, store } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const before = service.current();

    const other = createChat("https://other.example.com");
    await store.save(other, { immediate: true });

    const boom = new StorageError("Unavailable", "the store did not answer");
    store.failures.setCurrentChatForTab = boom;
    const [, err] = await service.openChat(other.id);

    expect(err).toBe(boom);
    // Pointer first, swap second: History stays where it is and can say why,
    // instead of the transcript having already changed underneath it.
    expect(service.current()).toBe(before);
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
    expect(await service.setSelection(1, { providerId: "p", model: "m" }, false)).toEqual([
      true,
      undefined,
    ]);

    expect(service.getSelection(1)).toEqual({
      selection: { providerId: "p", model: "m" },
      explicit: false,
    });
    expect(service.getSelection(999)).toBeUndefined();
  });

  it("setSelection returns ok(false) when no chat is loaded for that tab", async () => {
    const { service } = makeService();
    expect(await service.setSelection(1, { providerId: "p", model: "m" }, true)).toEqual([
      false,
      undefined,
    ]);
  });

  // Card 95: the write failure is returned, and the choice STAYS on the live
  // session — card 27's single-owner rule means this is the same object the
  // turn appends to, and snapping it back would change which model a chat
  // already in progress is talking to.
  it("setSelection returns the write failure but leaves the choice live for this panel", async () => {
    const { service, store } = makeService();
    await service.syncToTab(1, "https://a.example.com");

    const boom = new StorageError("Unavailable", "the store did not answer");
    store.failures.save = boom;
    const [, err] = await service.setSelection(1, { providerId: "p", model: "m" }, true);

    expect(err).toBe(boom);
    expect(service.getSelection(1)).toEqual({
      selection: { providerId: "p", model: "m" },
      explicit: true,
    });
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
    await expect(service.renameCurrent("x")).resolves.toEqual([undefined, undefined]);
  });

  // Card 95: the name the user typed is already on screen, so the failure is
  // returned ("not durable") rather than the title being reverted under them.
  it("returns the write failure with the new title still applied", async () => {
    const { service, store } = makeService();
    await service.syncToTab(1, "https://a.example.com");

    const boom = new StorageError("Unavailable", "the store did not answer");
    store.failures.save = boom;
    const [, err] = await service.renameCurrent("Named");

    expect(err).toBe(boom);
    expect(service.current()!.title).toBe("Named");
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
    expect(service.current()!.messages).toEqual([
      expect.objectContaining({ id, role: "user", content: "hello" }),
    ]);
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

    // Card 87: `id` is a fresh, per-instance entry id — NOT `call.id` — so
    // that two calls sharing one `call.id` in the same round each get their
    // own addressable entry. The model's own call id still round-trips
    // separately via `toolCallId`.
    expect(id).not.toBe(call.id);

    const chat = service.current()!;
    expect(chat.messages.find((m) => m.id === id)).toMatchObject({
      toolCallId: "call-1",
      toolStatus: "success",
      content: "result text",
    });
    // The tool-call log entry is keyed by the SAME minted `id`, not
    // `call.id`, so `ToolCallRow.svelte`'s `entry.id === message.id` lookup
    // between the transcript and the call log still lines up.
    expect(chat.toolCalls).toEqual([
      expect.objectContaining({ id, name: "read", mode: "auto", result: "result text" }),
    ]);
  });

  it("addAssistantNote stores the note's KIND and no prose, plus optional action chips", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const id = service.addAssistantNote({ kind: "iteration-cap", limit: 8 }, [{ kind: "retry" }]);
    const entry = service.current()!.messages.find((m) => m.id === id);
    // Card 114 (decisions/38): `content` is empty BY CONSTRUCTION. This is the
    // assertion that stops prose from creeping back into storage — the words
    // are the renderer's, so switching the panel's language re-reads history.
    expect(entry?.content).toBe("");
    expect(entry?.note).toEqual({ kind: "iteration-cap", limit: 8 });
    expect(entry?.actions).toEqual([{ kind: "retry" }]);
  });

  it("updateToolCallResult carries an extension-authored outcome as a kind into BOTH the transcript and the call log", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const call = { id: "call-1", name: "submit", arguments: {} };
    const id = service.addToolCall(call, { mode: "denied" });
    service.updateToolCallResult(id, {
      status: "denied",
      content: "",
      note: { kind: "tool-denied" },
    });

    const chat = service.current()!;
    // The inspector and the transcript are two views of ONE call: converting
    // only the transcript would have left the same denial reading in the
    // user's language in one panel and in English in the other.
    expect(chat.messages.find((m) => m.id === id)).toMatchObject({
      toolStatus: "denied",
      content: "",
      note: { kind: "tool-denied" },
    });
    expect(chat.toolCalls).toEqual([
      expect.objectContaining({ id, error: "", errorNote: { kind: "tool-denied" } }),
    ]);
  });

  it("a TOOL's own failure message stays verbatim and earns no kind", async () => {
    const { service } = makeService();
    await service.syncToTab(1, "https://a.example.com");
    const id = service.addToolCall({ id: "call-1", name: "read", arguments: {} }, { mode: "auto" });
    // Paraphrasing a page's or a server's own diagnostic is how it stops being
    // one — decisions/38 is about copy WE compose, not text that arrives from
    // outside the extension.
    service.updateToolCallResult(id, { status: "error", content: "ECONNREFUSED at :7331" });

    const chat = service.current()!;
    expect(chat.messages.find((m) => m.id === id)?.note).toBeUndefined();
    expect(chat.messages.find((m) => m.id === id)?.content).toBe("ECONNREFUSED at :7331");
    expect(chat.toolCalls[0]?.errorNote).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Card 106 (filed by card 96's audit): the fire-and-forget transcript writes
// now report a typed StorageFailureReport instead of a developer string, and
// report a "recovered" counterpart once a chat whose write had been failing
// saves successfully again — the retraction signal a persistent "this
// conversation isn't being saved" notice needs.
// ---------------------------------------------------------------------------

describe("ChatService transcript mutators — storage failure (card 106)", () => {
  it("reports a typed transcript-write failure for a failing fire-and-forget write", async () => {
    const reportStorageFailure = vi.fn();
    const { service, store } = makeService({ reportStorageFailure });
    await service.syncToTab(1, "https://a.example.com");
    const chatId = service.current()!.id;

    const boom = new StorageError("Unavailable", "the store did not answer");
    store.failures.save = boom;
    service.addUserMessage("hello");

    await vi.waitFor(() => expect(reportStorageFailure).toHaveBeenCalled());

    expect(reportStorageFailure).toHaveBeenCalledExactlyOnceWith({
      kind: "failed",
      operation: "transcript-write",
      chatId,
      tabId: undefined,
      error: boom,
    });
  });

  it("reports recovered exactly once after a run of failures, and stays quiet on ordinary successes afterwards", async () => {
    const reportStorageFailure = vi.fn();
    const { service, store } = makeService({ reportStorageFailure });
    await service.syncToTab(1, "https://a.example.com");
    const chatId = service.current()!.id;

    const boom = new StorageError("Unavailable", "the store did not answer");
    store.failures.save = boom;
    // A run of failing debounced writes — each one reports, since the
    // panel-side de-duplication (src/sidepanel/stores/notices.svelte.ts) is
    // what collapses these to one notice, not the domain.
    service.addUserMessage("first");
    await vi.waitFor(() => expect(reportStorageFailure).toHaveBeenCalledTimes(1));
    service.addUserMessage("second");
    await vi.waitFor(() => expect(reportStorageFailure).toHaveBeenCalledTimes(2));

    // Storage starts working again: the very next write for this chat both
    // succeeds AND earns the one-time "recovered" report.
    delete store.failures.save;
    service.addUserMessage("third");
    await vi.waitFor(() => expect(reportStorageFailure).toHaveBeenCalledTimes(3));

    // A later ordinary success is NOT a second recovery — there was nothing
    // outstanding to retract.
    service.addUserMessage("fourth");
    await vi.waitFor(() => expect(service.current()!.messages).toHaveLength(4));
    expect(reportStorageFailure).toHaveBeenCalledTimes(3);

    expect(reportStorageFailure).toHaveBeenNthCalledWith(1, {
      kind: "failed",
      operation: "transcript-write",
      chatId,
      tabId: undefined,
      error: boom,
    });
    expect(reportStorageFailure).toHaveBeenNthCalledWith(2, {
      kind: "failed",
      operation: "transcript-write",
      chatId,
      tabId: undefined,
      error: boom,
    });
    expect(reportStorageFailure).toHaveBeenNthCalledWith(3, {
      kind: "recovered",
      operation: "transcript-write",
      chatId,
    });
  });
});

// ---------------------------------------------------------------------------
// runTurn integration: auto-run + call-log mirroring + second round
// ---------------------------------------------------------------------------

describe("ChatService.runTurn — auto-run tool call end to end", () => {
  it("mirrors an auto-run tool call into the transcript AND the chat's tool-call log, then gives the model a second round", async () => {
    const { service } = makeService({
      policy: { mayAutoRun: async (tool) => tool?.annotations.readOnlyHint === true },
    });
    await service.syncToTab(1, "https://example.com");

    const readTool = makeTool({
      name: "get_title",
      readOnlyHint: true,
      call: async () => ({ ok: true, result: "Example Domain" }),
    });
    const gateway = scriptedGateway([
      [
        { type: "tool-calls", toolCalls: [{ id: "call-1", name: "get_title", arguments: {} }] },
        doneEvent(),
      ],
      [{ type: "content", delta: "It's Example Domain" }, doneEvent()],
    ]);

    await service.runTurn("what's the title?", {
      model: gateway,
      modelId: "m",
      tools: { toolsForTurn: async () => [readTool] },
      approvals: vi.fn(async () => "denied" as ApprovalDecision),
      page,
      attachTools: true,
      sharingAllowed: true,
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
    expect(chat.messages.filter((m) => m.role === "assistant").at(-1)?.content).toBe(
      "It's Example Domain",
    );
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
      sharingAllowed: true,
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
      sharingAllowed: true,
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
      sharingAllowed: true,
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
  // FIXED on card 87 (was a known bug journalled on card 85): `runTurn`'s
  // `finally` block used to unconditionally delete `liveSessions`/
  // `stopHandlers` for the chat id it captured (./service.ts), with no way
  // to tell "the registration I set up" from "whatever is registered now".
  // Two turns racing for the SAME chat (e.g. a doubled-up "send" click, or a
  // retry fired before the first request settled) is never guarded against
  // anywhere in this port, so the FIRST turn finishing cleared the
  // registration out from under the SECOND one, which was still genuinely
  // streaming. Fixed with a per-chat active-turn refcount
  // (`activeTurnCounts`): registration is only torn down by the turn that
  // brings the count back to zero, so a still-running sibling keeps
  // `isTurnActive` (and `requestStop`, which now always targets the LATEST
  // turn's controller) working correctly.
  it("keeps reporting the chat as turn-active while the second turn is still streaming", async () => {
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
      sharingAllowed: true,
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
      sharingAllowed: true,
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
      sharingAllowed: true,
    });
    await reachedGate.promise;

    // The user deletes this chat from History (or it's evicted) WHILE it is
    // still streaming — the store no longer has it, but the turn's own
    // in-memory session is still live.
    await store.deleteChat(chat.id);
    await service.syncToTab(2, "https://b.example.com"); // look elsewhere first

    expect(await service.openChat(chat.id)).toEqual([true, undefined]);
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
      sharingAllowed: true,
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
    expect(chat.messages.filter((m) => m.role === "assistant").at(-1)?.content).toBe(
      "still writing",
    );
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

// ---------------------------------------------------------------------------
// Page-context markers on the user's turn
// (card 119, decisions/40-page-context-access.md; decisions/38's kind+params)
// ---------------------------------------------------------------------------

describe("ChatService.runTurn — what the transcript records about shared page context", () => {
  /** One turn against a gateway that says nothing, so only the user entry matters. */
  async function runWith(request: Partial<RunTurnRequest>) {
    const { service } = makeService();
    await service.syncToTab(1, "https://example.com");
    await service.runTurn("what does this say?", {
      model: scriptedGateway([[doneEvent()]]),
      modelId: "m",
      tools: { toolsForTurn: async () => [] },
      approvals: vi.fn(async () => "denied" as ApprovalDecision),
      page,
      attachTools: false,
      sharingAllowed: true,
      ...request,
    });
    return service.current()!.messages.find((m) => m.role === "user")!;
  }

  function snapshot(
    mode: PageContextSnapshot["mode"],
    text: string,
    truncated = false,
  ): PageContextSnapshot {
    return {
      mode,
      text,
      url: "https://example.com/",
      title: "Example",
      truncated,
      bytes: text.length,
    };
  }

  it("records nothing at all for an ordinary turn — the stored shape is unchanged", async () => {
    const entry = await runWith({});
    expect(entry.sharedContext).toBeUndefined();
  });

  it("records a kind per snapshot, in the order they were attached", async () => {
    const entry = await runWith({
      pageContext: [
        snapshot("selection", "the bit I highlighted"),
        snapshot("extract", "the page"),
      ],
    });

    expect(entry.sharedContext).toEqual([
      { kind: "page-selection", truncated: false },
      { kind: "page-content", truncated: false },
    ]);
  });

  it("records the truncation, which is the one fact the user cannot otherwise recover", async () => {
    const entry = await runWith({ pageContext: [snapshot("extract", "the start of it", true)] });

    expect(entry.sharedContext).toEqual([{ kind: "page-content", truncated: true }]);
  });

  it("stores no prose and no page text — a kind and a flag, nothing else (decisions/38)", async () => {
    const entry = await runWith({
      pageContext: [snapshot("selection", "SOME VERY PRIVATE SELECTED TEXT")],
    });

    expect(JSON.stringify(entry)).not.toContain("SOME VERY PRIVATE SELECTED TEXT");
  });

  it("records nothing for an empty snapshot — nothing was shared, so nothing is claimed", async () => {
    const entry = await runWith({ pageContext: [snapshot("selection", "")] });
    expect(entry.sharedContext).toBeUndefined();
  });

  it("records nothing when the sharing gate is down, whatever the request carries", async () => {
    const entry = await runWith({
      sharingAllowed: false,
      pageContext: [snapshot("selection", "should never have got here")],
    });

    expect(entry.sharedContext).toBeUndefined();
  });
});

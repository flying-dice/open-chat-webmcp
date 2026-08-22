// Tests for the chat repository — round-trips, the debounced write
// scheduler, index write serialization, and the eviction backstop (card 83,
// card 74's journal: recreating the 33 ad-hoc Node assertions against an
// in-memory fake as committed tests).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChat, MAX_RETAINED_CHATS, type ChatSession } from "../../domain/chat";
import { createChromeStorageChatStore } from "./chat-store";
import { createStorageAreaGateway } from "./area";
import { createFakeChromeStorage } from "./testing/fake-chrome-storage";

function setup() {
  const fake = createFakeChromeStorage();
  vi.stubGlobal("chrome", fake.chrome);
  const local = createStorageAreaGateway("local");
  const store = createChromeStorageChatStore(local);
  return { fake, store };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("round-trips", () => {
  it("save(immediate) then getChat returns the same session", async () => {
    const { store } = setup();
    const chat = createChat("https://example.com");
    chat.messages.push({ role: "user", content: "hi" } as ChatSession["messages"][number]);

    await store.save(chat, { immediate: true });
    const loaded = await store.getChat(chat.id);

    expect(loaded?.id).toBe(chat.id);
    expect(loaded?.messages).toEqual(chat.messages);
  });

  it("getChat returns undefined for an id that was never saved", async () => {
    const { store } = setup();
    await expect(store.getChat("nope")).resolves.toBeUndefined();
  });

  it("deleteChat removes the chat, its index entry, and any tab pointer targeting it", async () => {
    const { store, fake } = setup();
    const chat = createChat("https://example.com");
    await store.save(chat, { immediate: true });
    await store.setCurrentChatForTab(7, chat.id, "https://example.com");

    await store.deleteChat(chat.id);

    await expect(store.getChat(chat.id)).resolves.toBeUndefined();
    await expect(store.listChatSummaries()).resolves.toEqual([]);
    expect(fake.local.raw()["tabchat:7"]).toBeUndefined();
  });

  it("clearAllChats removes every chat:* and tabchat:* key but leaves unrelated keys alone", async () => {
    const { store, fake } = setup();
    const chat = createChat("https://example.com");
    await store.save(chat, { immediate: true });
    await store.setCurrentChatForTab(3, chat.id, "https://example.com");
    fake.local.seed({ "debug:tab-sync-tracing": true });

    await store.clearAllChats();

    const raw = fake.local.raw();
    expect(Object.keys(raw).some((k) => k.startsWith("chat:"))).toBe(false);
    expect(Object.keys(raw).some((k) => k.startsWith("tabchat:"))).toBe(false);
    expect(raw["debug:tab-sync-tracing"]).toBe(true);
  });

  it("listChatSummaries sorts newest-updated first", async () => {
    const { store } = setup();
    const older = createChat("https://a.example");
    older.updatedAt = 100;
    const newer = createChat("https://b.example");
    newer.updatedAt = 200;

    await store.save(older, { immediate: true, touch: false });
    await store.save(newer, { immediate: true, touch: false });

    const summaries = await store.listChatSummaries();
    expect(summaries.map((s) => s.id)).toEqual([newer.id, older.id]);
  });
});

describe("getOrCreateChatForTab", () => {
  it("returns a fresh, unresolved chat when the tab has no pointer", async () => {
    const { store } = setup();
    const result = await store.getOrCreateChatForTab(1, "https://example.com");
    expect(result.resolved).toBe(false);
    expect(result.chat.origin).toBe("https://example.com");
  });

  it("resolves the pointed-at chat when the pointer's tabOrigin matches", async () => {
    const { store } = setup();
    const chat = createChat("https://example.com");
    await store.save(chat, { immediate: true });
    await store.setCurrentChatForTab(1, chat.id, "https://example.com");

    const result = await store.getOrCreateChatForTab(1, "https://example.com");
    expect(result.resolved).toBe(true);
    expect(result.chat.id).toBe(chat.id);
  });

  it("does NOT resolve when the pointer's tabOrigin no longer matches (recycled tab id guard)", async () => {
    const { store } = setup();
    const chat = createChat("https://example.com");
    await store.save(chat, { immediate: true });
    await store.setCurrentChatForTab(1, chat.id, "https://example.com");

    const result = await store.getOrCreateChatForTab(1, "https://different.example");
    expect(result.resolved).toBe(false);
    expect(result.chat.id).not.toBe(chat.id);
  });

  it("does NOT resolve when the pointer targets a chat that no longer exists (deleted or corrupt)", async () => {
    const { store, fake } = setup();
    await store.setCurrentChatForTab(1, "ghost-id", "https://example.com");
    fake.local.seed({ "chat:ghost-id": { not: "a valid chat session" } });

    const result = await store.getOrCreateChatForTab(1, "https://example.com");
    expect(result.resolved).toBe(false);
    expect(result.chat.id).not.toBe("ghost-id");
  });
});

describe("debounced write scheduling", () => {
  it("writes once for a burst of saves inside the debounce window, not once per save", async () => {
    const { store, fake } = setup();
    const chat = createChat("https://example.com");
    await store.save(chat, { immediate: true }); // baseline: 1 chat write + 1 index write
    const setCallsBeforeBurst = fake.local.callCount("set");

    for (let i = 0; i < 10; i++) {
      chat.messages.push({ role: "user", content: `msg ${i}` } as ChatSession["messages"][number]);
      await store.save(chat);
      await vi.advanceTimersByTimeAsync(50); // well under the 400ms debounce
    }

    // Nothing has committed yet — every save so far only reset the timer.
    expect(fake.local.callCount("set")).toBe(setCallsBeforeBurst);

    await vi.advanceTimersByTimeAsync(400);

    // Exactly one commit landed: one write for chat:<id>, one for chat:index.
    expect(fake.local.callCount("set")).toBe(setCallsBeforeBurst + 2);
    const loaded = await store.getChat(chat.id);
    expect(loaded?.messages).toHaveLength(10);
  });

  it("flush() commits a pending debounced write immediately and cancels its timers", async () => {
    const { store, fake } = setup();
    const chat = createChat("https://example.com");
    await store.save(chat); // debounced, nothing written yet
    expect(fake.local.raw()[`chat:${chat.id}`]).toBeUndefined();

    await store.flush(chat.id);

    expect(fake.local.raw()[`chat:${chat.id}`]).toBeDefined();
    const setCallsAfterFlush = fake.local.callCount("set");

    // The debounce timer that would have fired later must have been
    // cancelled by flush() — advancing past it must not write again.
    await vi.advanceTimersByTimeAsync(2000);
    expect(fake.local.callCount("set")).toBe(setCallsAfterFlush);
  });

  it("flush() on a chat with nothing pending resolves immediately without writing", async () => {
    const { store, fake } = setup();
    await store.flush("never-saved");
    expect(fake.local.callCount("set")).toBe(0);
  });

  it("flushAll() commits every chat with a pending write", async () => {
    const { store } = setup();
    const a = createChat("https://a.example");
    const b = createChat("https://b.example");
    await store.save(a);
    await store.save(b);

    await store.flushAll();

    await expect(store.getChat(a.id)).resolves.toBeDefined();
    await expect(store.getChat(b.id)).resolves.toBeDefined();
  });

  it("the max-wait timer forces a commit even under continuous debounce-resetting activity", async () => {
    const { store, fake } = setup();
    const chat = createChat("https://example.com");
    await store.save(chat, { immediate: true });
    const baseline = fake.local.callCount("set");

    // Keep resetting the 400ms debounce timer every 300ms — it would never
    // fire on its own — for long enough to cross the 2000ms max-wait bound.
    for (let i = 0; i < 7; i++) {
      chat.messages.push({ role: "user", content: `m${i}` } as ChatSession["messages"][number]);
      await store.save(chat);
      await vi.advanceTimersByTimeAsync(300);
    }

    // 7 * 300ms = 2100ms of continuous activity, past MAX_WAIT_MS (2000ms):
    // the max-wait timer must have forced at least one commit despite the
    // debounce timer never going quiet.
    expect(fake.local.callCount("set")).toBeGreaterThan(baseline);
  });

  it("save({immediate: true}) bypasses debouncing and writes synchronously", async () => {
    const { store, fake } = setup();
    const chat = createChat("https://example.com");
    await store.save(chat, { immediate: true });
    expect(fake.local.raw()[`chat:${chat.id}`]).toBeDefined();
  });

  it("save({touch: false}) does not overwrite updatedAt (used by rename)", async () => {
    const { store } = setup();
    const chat = createChat("https://example.com");
    chat.updatedAt = 12345;
    await store.save(chat, { immediate: true, touch: false });
    const loaded = await store.getChat(chat.id);
    expect(loaded?.updatedAt).toBe(12345);
  });

  it("save() without touch:false stamps updatedAt to now", async () => {
    const { store } = setup();
    const chat = createChat("https://example.com");
    chat.updatedAt = 1;
    vi.setSystemTime(999_000);
    await store.save(chat, { immediate: true });
    const loaded = await store.getChat(chat.id);
    expect(loaded?.updatedAt).toBe(999_000);
  });
});

describe("index write serialization under concurrent writers", () => {
  it("two concurrent immediate saves for different chats both land in the index (no lost update)", async () => {
    const { store } = setup();
    const a = createChat("https://a.example");
    const b = createChat("https://b.example");

    await Promise.all([store.save(a, { immediate: true }), store.save(b, { immediate: true })]);

    const summaries = await store.listChatSummaries();
    expect(summaries.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("many concurrent immediate saves all survive (stress the index lock)", async () => {
    const { store } = setup();
    const chats = Array.from({ length: 20 }, (_, i) => createChat(`https://n${i}.example`));

    await Promise.all(chats.map((c) => store.save(c, { immediate: true })));

    const summaries = await store.listChatSummaries();
    expect(summaries).toHaveLength(20);
  });
});

describe("eviction backstop at MAX_RETAINED_CHATS", () => {
  it("evicts the oldest-by-updatedAt chat once the count exceeds the cap, and cleans up its tab pointer", async () => {
    const { store, fake } = setup();

    const chats: ChatSession[] = [];
    for (let i = 0; i <= MAX_RETAINED_CHATS; i++) {
      const chat = createChat(`https://n${i}.example`);
      chat.updatedAt = i; // fully controlled ordering — i=0 is the oldest
      chats.push(chat);
    }
    const oldest = chats[0]!;
    await store.setCurrentChatForTab(999, oldest.id, oldest.origin);

    for (const chat of chats) {
      await store.save(chat, { immediate: true, touch: false });
    }

    const summaries = await store.listChatSummaries();
    expect(summaries).toHaveLength(MAX_RETAINED_CHATS);
    expect(summaries.some((s) => s.id === oldest.id)).toBe(false);
    expect(summaries.some((s) => s.id === chats[chats.length - 1]!.id)).toBe(true);

    // The evicted chat's own record and its tab pointer are gone too.
    expect(fake.local.raw()[`chat:${oldest.id}`]).toBeUndefined();
    expect(fake.local.raw()["tabchat:999"]).toBeUndefined();
  });

  it("does not evict anything while at or under the cap", async () => {
    const { store } = setup();
    for (let i = 0; i < 5; i++) {
      const chat = createChat(`https://n${i}.example`);
      await store.save(chat, { immediate: true });
    }
    await expect(store.listChatSummaries()).resolves.toHaveLength(5);
  });
});

describe("defensive reads of corrupt storage", () => {
  it("getChat drops a record that fails isChatSession validation, returning undefined rather than throwing", async () => {
    const { store, fake } = setup();
    fake.local.seed({ "chat:bad": { id: "bad", origin: "https://x", messages: "not-an-array" } });
    await expect(store.getChat("bad")).resolves.toBeUndefined();
  });

  it("listChatSummaries drops index entries that fail isChatIndexEntry validation", async () => {
    const { store, fake } = setup();
    fake.local.seed({
      "chat:index": [
        {
          id: "ok",
          origin: "https://x",
          createdAt: 1,
          updatedAt: 2,
          messageCount: 0,
          toolCallCount: 0,
        },
        { id: "bad", origin: "https://x" }, // missing required numeric fields
      ],
    });
    const summaries = await store.listChatSummaries();
    expect(summaries.map((s) => s.id)).toEqual(["ok"]);
  });
});

// ---------------------------------------------------------------------------
// Chaos: unhappy paths the suites above don't cover (card 85,
// .claude/skills/chaos-monkey/SKILL.md) — quota exceeded mid-write, and
// acting on a chat that was deleted out from under a pending write.
// ---------------------------------------------------------------------------

describe("chaos: quota exceeded mid-write leaves a half-written index", () => {
  it("a chat write that succeeds followed by an index write that hits quota leaves the chat orphaned but still readable, and rejects", async () => {
    const { fake, store } = setup();
    const session = createChat("https://example.com");

    // `commit()` (./chat-store.ts) writes `chat:<id>` first, then
    // read-modify-writes `chat:index` — two separate `chrome.storage.local.set`
    // calls. Fail ONLY the second (the index) so the chat's own record has
    // already landed by the time the quota error hits, exactly like a real
    // `chrome.storage.local.set` throwing partway through two backend calls.
    const originalSet = fake.chrome.storage.local.set.bind(fake.chrome.storage.local);
    fake.chrome.storage.local.set = vi.fn(async (entries: Record<string, unknown>) => {
      if ("chat:index" in entries) throw new Error("QUOTA_BYTES quota exceeded");
      return originalSet(entries);
    }) as typeof fake.chrome.storage.local.set;

    await expect(store.save(session, { immediate: true })).rejects.toThrow(/quota/i);

    // The chat's own record is NOT lost — `local.write` for the chat key
    // already resolved before the index write blew up.
    await expect(store.getChat(session.id)).resolves.toMatchObject({ id: session.id });
    // But it is invisible to a history listing: the index write never landed.
    await expect(store.listChatSummaries()).resolves.toEqual([]);
  });
});

describe("chaos: a debounced write landing after the chat it targets was deleted", () => {
  it("flush() after deleteChat() resurrects the chat — the 'don't resurrect a deleted chat' guard lives in ChatService, not this store", async () => {
    const { store } = setup();
    const session = createChat("https://example.com");
    await store.save(session, { immediate: true });

    await store.deleteChat(session.id);
    await expect(store.getChat(session.id)).resolves.toBeUndefined();

    // A caller that (unlike ChatService.discardIfDeleted) still holds a
    // reference to the deleted session and schedules a debounced write for
    // it — e.g. a straggling `appendAssistantDelta` from a turn that hadn't
    // noticed the deletion yet — is not guarded against at this layer.
    session.messages.push({ id: "m1", role: "user", content: "too late", createdAt: Date.now() });
    await store.save(session);
    vi.advanceTimersByTime(2000);
    await store.flush(session.id);

    // Documented current behaviour, not asserted as correct: the chat comes
    // back. The actual guard against this ("a later message can't resurrect
    // a chat the user just deleted") is `ChatService.discardIfDeleted`
    // (src/domain/chat/service.ts), which only ever hands a FRESH chat back
    // to a caller in this situation rather than continuing to write to the
    // stale one — so a caller that bypasses the service (as this test does,
    // by talking to the store directly) does not get that protection.
    await expect(store.getChat(session.id)).resolves.toMatchObject({ id: session.id });
  });
});

// Tests for src/background/sw.ts — the service worker's message router and
// per-tab tool registry (card 88,
// boards/project-backlog/88-close-remaining-test-gaps.md).
//
// sw.ts exports nothing (`export {}` — every function is module-private) and
// registers its `chrome.runtime.onMessage`/`chrome.tabs.on*` listeners as a
// SIDE EFFECT of being imported. The seam this file uses instead of adding
// exports (per the card: "check first whether its functions are importable"
// before proposing a restructure) is the same one src/infra/chrome-runtime/
// tab-sync.test.ts already established for exactly this situation: install a
// fake `chrome` global BEFORE importing the module, capture the listener
// function(s) it registers via `addListener`, then invoke them directly with
// hand-built messages/senders — the same shape a real `chrome.runtime`
// delivery would take, without needing a real browser or any export sw.ts
// doesn't already have.
//
// `vi.resetModules()` + a fresh dynamic `import("./sw")` per test gives each
// test its own module instance — and so its own empty `registry` Map — since
// the registry is closed-over module state with no reset hook.
//
// See the module doc comment on the card's "runtime:call-tool-response
// arriving for a superseded turn" scope note: sw.ts turns out to hold no
// explicit broker/registry that could misroute a call-tool response at all
// — `chrome.runtime.onMessage`'s per-call `sendResponse` closure (registered
// fresh inside `handleCallTool` for every `runtime:call-tool`) is what
// correlates a request with its response, not a keyed map this module
// maintains. The closest thing sw.ts has to a stateful "registry" is the
// per-TAB tools cache (`registry: Map<tabId, RegistryEntry>`), which this
// file exercises instead — including the analogous "response for something
// no longer current" shape that registry actually has: a `tools-updated`
// push for a tab that has since been removed.

import { afterEach, describe, expect, it, vi } from "vitest";

// A local, structural stand-in for `chrome.runtime.MessageSender` — narrow
// to just the `tab.id` field sw.ts actually reads — so this file never needs
// to spell the `chrome.*` namespace itself. scripts/guard-boundaries.mjs's
// chrome.* containment scan is a textual scan over every non-comment line in
// src/ (not just src/domain, and not test-file-excluded like
// dependency-cruiser is), so a real `chrome.runtime.MessageSender` type
// reference here would read as a call site even though it's only a type.
interface FakeSender {
  tab?: { id: number };
}

type MessageListener = (
  message: unknown,
  sender: FakeSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;
type TabsUpdatedListener = (tabId: number, changeInfo: { url?: string }) => void;
type TabsRemovedListener = (tabId: number) => void;

function createFakeChrome() {
  const messageListeners: MessageListener[] = [];
  const tabsUpdatedListeners: TabsUpdatedListener[] = [];
  const tabsRemovedListeners: TabsRemovedListener[] = [];

  let tabsSendMessageImpl: (
    tabId: number,
    message: unknown,
    callback: (response?: unknown) => void,
  ) => void = (_tabId, _message, callback) => callback(undefined);
  let lastError: { message: string } | undefined;

  const fakeChrome = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: {
        addListener: (l: MessageListener) => messageListeners.push(l),
      },
      sendMessage: vi.fn((_message: unknown, callback?: (response?: unknown) => void) => {
        callback?.(undefined);
      }),
      get lastError() {
        return lastError;
      },
    },
    tabs: {
      onUpdated: { addListener: (l: TabsUpdatedListener) => tabsUpdatedListeners.push(l) },
      onRemoved: { addListener: (l: TabsRemovedListener) => tabsRemovedListeners.push(l) },
      sendMessage: vi.fn(
        (tabId: number, message: unknown, callback: (response?: unknown) => void) => {
          tabsSendMessageImpl(tabId, message, callback);
        },
      ),
    },
  } as unknown as typeof chrome;

  return {
    chrome: fakeChrome,
    /** Deliver a message to sw.ts's `chrome.runtime.onMessage` listener directly, the same shape a real relay/panel send would arrive as. Resolves with whatever `sendResponse` is eventually called with — or immediately with `undefined` if no listener kept the response channel open (a one-way notification, or an unrecognized message type), mirroring how `chrome.runtime.sendMessage`'s own callback behaves in that case. */
    async deliver(message: unknown, sender: FakeSender = {}): Promise<unknown> {
      return new Promise((resolve) => {
        let keptOpen = false;
        for (const l of messageListeners) {
          const result = l(message, sender, (response) => resolve(response));
          if (result === true) keptOpen = true;
        }
        if (!keptOpen) resolve(undefined);
      });
    },
    fireTabUpdated(tabId: number, changeInfo: { url?: string }) {
      for (const l of tabsUpdatedListeners) l(tabId, changeInfo);
    },
    fireTabRemoved(tabId: number) {
      for (const l of tabsRemovedListeners) l(tabId);
    },
    setTabsSendMessageImpl(fn: typeof tabsSendMessageImpl) {
      tabsSendMessageImpl = fn;
    },
    setLastError(err: { message: string } | undefined) {
      lastError = err;
    },
    messageListenerCount: () => messageListeners.length,
  };
}

async function loadSw() {
  vi.resetModules();
  return import("./sw");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sw.ts message router", () => {
  it("registers exactly one onMessage listener on import (module-scope wiring survives a worker restart replay)", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    await loadSw();
    expect(fake.messageListenerCount()).toBe(1);
  });

  it("a runtime:tools-updated push from a relay populates the tab registry and broadcasts it onward", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    await loadSw();

    const response = await fake.deliver(
      {
        type: "runtime:tools-updated",
        tabId: -1,
        origin: "https://a.example",
        available: true,
        tools: [{ name: "x" }],
      },
      { tab: { id: 7 } },
    );
    // A one-way notification: the listener returns false, no response ever fires.
    expect(response).toBeUndefined();

    // The cached entry rebuilds the very next get-tools without hitting the relay.
    const getResponse = await fake.deliver({ type: "runtime:get-tools", tabId: 7 });
    expect(getResponse).toEqual({
      type: "runtime:get-tools-response",
      tabId: 7,
      available: true,
      restricted: false,
      tools: [{ name: "x" }],
    });
  });

  it("a runtime:tools-updated push with no sender.tab.id is ignored — cannot be spoofed by page content", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    await loadSw();

    await fake.deliver(
      {
        type: "runtime:tools-updated",
        tabId: -1,
        origin: "https://a.example",
        available: true,
        tools: [{ name: "x" }],
      },
      {}, // no sender.tab at all
    );

    // Nothing cached for tab 7 — the worker must fall through to a relay pull, not silently trust the push.
    fake.setTabsSendMessageImpl((_tabId, _message, callback) => callback(undefined));
    const getResponse = await fake.deliver({ type: "runtime:get-tools", tabId: 7 });
    expect(getResponse).toMatchObject({ available: false, tools: [] });
  });

  it("an unrecognized message type is ignored (listener returns false, no crash)", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    await loadSw();
    await expect(fake.deliver({ type: "not-a-real-message" })).resolves.toBeUndefined();
  });

  describe("runtime:get-tools cache-miss rebuild", () => {
    it("rebuilds live from the relay on a cache miss (e.g. a service-worker restart lost the in-memory registry)", async () => {
      const fake = createFakeChrome();
      vi.stubGlobal("chrome", fake.chrome);
      fake.setTabsSendMessageImpl((_tabId, message, callback) => {
        expect((message as { type: string }).type).toBe("runtime:refresh-tools");
        callback({
          type: "runtime:tools-updated",
          tabId: 3,
          origin: "https://b.example",
          available: true,
          tools: [{ name: "y" }],
        });
      });
      await loadSw();

      const response = await fake.deliver({ type: "runtime:get-tools", tabId: 3 });
      expect(response).toEqual({
        type: "runtime:get-tools-response",
        tabId: 3,
        available: true,
        restricted: false,
        tools: [{ name: "y" }],
      });
    });

    it("a tab with no relay at all (chrome://, Web Store, PDF viewer) reports restricted: true, not a generic failure", async () => {
      const fake = createFakeChrome();
      vi.stubGlobal("chrome", fake.chrome);
      fake.setTabsSendMessageImpl((_tabId, _message, callback) => {
        fake.setLastError({
          message: "Could not establish connection. Receiving end does not exist.",
        });
        callback(undefined);
      });
      await loadSw();

      const response = await fake.deliver({ type: "runtime:get-tools", tabId: 9 });
      expect(response).toEqual({
        type: "runtime:get-tools-response",
        tabId: 9,
        available: false,
        restricted: true,
        tools: [],
      });
    });

    it("a relay that answers with an unexpected shape degrades to empty tools, not a crash", async () => {
      const fake = createFakeChrome();
      vi.stubGlobal("chrome", fake.chrome);
      fake.setTabsSendMessageImpl((_tabId, _message, callback) =>
        callback({ type: "runtime:tools-updated" }),
      ); // missing origin/available/tools
      await loadSw();

      const response = await fake.deliver({ type: "runtime:get-tools", tabId: 4 });
      expect(response).toMatchObject({ available: false, restricted: false, tools: [] });
    });
  });

  describe("runtime:call-tool routing", () => {
    it("relays a call-tool request to the tab and returns the relay's response verbatim", async () => {
      const fake = createFakeChrome();
      vi.stubGlobal("chrome", fake.chrome);
      fake.setTabsSendMessageImpl((tabId, message, callback) => {
        expect(tabId).toBe(5);
        expect(message).toMatchObject({ type: "runtime:call-tool", name: "doThing" });
        callback({ type: "runtime:call-tool-response", ok: true, result: { done: true } });
      });
      await loadSw();

      const response = await fake.deliver({
        type: "runtime:call-tool",
        tabId: 5,
        name: "doThing",
        args: {},
      });
      expect(response).toEqual({
        type: "runtime:call-tool-response",
        ok: true,
        result: { done: true },
      });
    });

    it("a relay response of an unexpected shape is reported as a call failure, never passed through raw", async () => {
      const fake = createFakeChrome();
      vi.stubGlobal("chrome", fake.chrome);
      fake.setTabsSendMessageImpl((_tabId, _message, callback) =>
        callback({ unexpected: "shape" }),
      );
      await loadSw();

      const response = await fake.deliver({
        type: "runtime:call-tool",
        tabId: 5,
        name: "doThing",
        args: {},
      });
      expect(response).toMatchObject({ type: "runtime:call-tool-response", ok: false });
    });

    it("no relay in the tab surfaces a descriptive error naming the tab, not a hang", async () => {
      const fake = createFakeChrome();
      vi.stubGlobal("chrome", fake.chrome);
      fake.setTabsSendMessageImpl((_tabId, _message, callback) => {
        fake.setLastError({
          message: "Could not establish connection. Receiving end does not exist.",
        });
        callback(undefined);
      });
      await loadSw();

      const response = await fake.deliver({
        type: "runtime:call-tool",
        tabId: 5,
        name: "doThing",
        args: {},
      });
      expect(response).toMatchObject({ type: "runtime:call-tool-response", ok: false });
      expect((response as { error: string }).error).toContain(
        "No WebMCP relay is available in tab 5",
      );
    });

    describe("chaos: overlapping calls to the same tab resolve independently, even out of order", () => {
      it("two concurrent runtime:call-tool requests to the SAME tab never cross-wire their results, regardless of response arrival order", async () => {
        const fake = createFakeChrome();
        vi.stubGlobal("chrome", fake.chrome);
        const pending: { message: unknown; callback: (response?: unknown) => void }[] = [];
        fake.setTabsSendMessageImpl((_tabId, message, callback) => {
          pending.push({ message, callback }); // don't answer yet — simulate both calls in flight at once
        });
        await loadSw();

        const firstCall = fake.deliver({
          type: "runtime:call-tool",
          tabId: 5,
          name: "toolA",
          args: {},
        });
        const secondCall = fake.deliver({
          type: "runtime:call-tool",
          tabId: 5,
          name: "toolB",
          args: {},
        });
        await vi.waitFor(() => expect(pending.length).toBe(2));

        // Resolve the SECOND request first (out-of-order delivery from the relay/tab).
        const forToolB = pending.find((p) => (p.message as { name: string }).name === "toolB")!;
        const forToolA = pending.find((p) => (p.message as { name: string }).name === "toolA")!;
        forToolB.callback({ type: "runtime:call-tool-response", ok: true, result: "result-for-B" });
        forToolA.callback({ type: "runtime:call-tool-response", ok: true, result: "result-for-A" });

        const [first, second] = await Promise.all([firstCall, secondCall]);
        expect(first).toEqual({
          type: "runtime:call-tool-response",
          ok: true,
          result: "result-for-A",
        });
        expect(second).toEqual({
          type: "runtime:call-tool-response",
          ok: true,
          result: "result-for-B",
        });
      });

      it("a call for a NEWER turn resolves correctly even while an OLDER, now-superseded call to the same tab is still stuck waiting", async () => {
        const fake = createFakeChrome();
        vi.stubGlobal("chrome", fake.chrome);
        let staleCallback: ((response?: unknown) => void) | undefined;
        let calls = 0;
        fake.setTabsSendMessageImpl((_tabId, message, callback) => {
          calls++;
          if ((message as { name: string }).name === "staleTool") {
            staleCallback = callback; // the "superseded turn"'s call never gets answered until later
            return;
          }
          callback({ type: "runtime:call-tool-response", ok: true, result: "fresh-result" });
        });
        await loadSw();

        const stalePromise = fake.deliver({
          type: "runtime:call-tool",
          tabId: 5,
          name: "staleTool",
          args: {},
        });
        const freshResult = await fake.deliver({
          type: "runtime:call-tool",
          tabId: 5,
          name: "freshTool",
          args: {},
        });

        expect(freshResult).toEqual({
          type: "runtime:call-tool-response",
          ok: true,
          result: "fresh-result",
        });
        expect(calls).toBe(2);

        // The stale call finally answers late — it must resolve to ITS OWN result, never the fresh one's.
        staleCallback?.({ type: "runtime:call-tool-response", ok: true, result: "stale-result" });
        await expect(stalePromise).resolves.toEqual({
          type: "runtime:call-tool-response",
          ok: true,
          result: "stale-result",
        });
      });
    });
  });

  describe("registry lifecycle", () => {
    it("clears the cached registry entry on tab navigation (URL change)", async () => {
      const fake = createFakeChrome();
      vi.stubGlobal("chrome", fake.chrome);
      await loadSw();
      await fake.deliver(
        {
          type: "runtime:tools-updated",
          tabId: -1,
          origin: "https://a.example",
          available: true,
          tools: [{ name: "x" }],
        },
        { tab: { id: 7 } },
      );

      fake.fireTabUpdated(7, { url: "https://b.example" });

      fake.setTabsSendMessageImpl((_tabId, _message, callback) => callback(undefined)); // relay unreachable now
      const response = await fake.deliver({ type: "runtime:get-tools", tabId: 7 });
      expect(response).toMatchObject({ tools: [] }); // no longer serving the stale, pre-navigation cache
    });

    it("clears the cached registry entry on tab removal, so a recycled tab id never inherits stale tools", async () => {
      const fake = createFakeChrome();
      vi.stubGlobal("chrome", fake.chrome);
      await loadSw();
      await fake.deliver(
        {
          type: "runtime:tools-updated",
          tabId: -1,
          origin: "https://a.example",
          available: true,
          tools: [{ name: "x" }],
        },
        { tab: { id: 7 } },
      );

      fake.fireTabRemoved(7);

      fake.setTabsSendMessageImpl((_tabId, _message, callback) => callback(undefined));
      const response = await fake.deliver({ type: "runtime:get-tools", tabId: 7 });
      expect(response).toMatchObject({ tools: [] });
    });

    it("a tools-updated push for a tab that is not the active one is still cached under ITS OWN tab id, not conflated with another tab", async () => {
      const fake = createFakeChrome();
      vi.stubGlobal("chrome", fake.chrome);
      await loadSw();

      await fake.deliver(
        {
          type: "runtime:tools-updated",
          tabId: -1,
          origin: "https://a.example",
          available: true,
          tools: [{ name: "x" }],
        },
        { tab: { id: 1 } },
      );
      await fake.deliver(
        {
          type: "runtime:tools-updated",
          tabId: -1,
          origin: "https://b.example",
          available: true,
          tools: [{ name: "y" }, { name: "z" }],
        },
        { tab: { id: 2 } },
      );

      const tab1 = await fake.deliver({ type: "runtime:get-tools", tabId: 1 });
      const tab2 = await fake.deliver({ type: "runtime:get-tools", tabId: 2 });
      expect(tab1).toMatchObject({ tools: [{ name: "x" }] });
      expect(tab2).toMatchObject({ tools: [{ name: "y" }, { name: "z" }] });
    });
  });
});

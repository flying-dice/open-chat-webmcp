// Chaos coverage for the chrome.tabs/chrome.runtime adapter that keeps a
// surface's page state in step with the active tab (card 85,
// .claude/skills/chaos-monkey/SKILL.md) — ./tab-sync.ts had NO dedicated
// test file at all before this card, despite being exactly the "message
// races between surfaces" fault surface the card calls out: a
// `runtime:tools-updated` broadcast racing a tab switch, and the
// `available`/`restricted`/empty-tools three-state model (decisions/16,
// card 31) that a panel must keep visually distinct.
//
// Deliberately narrow fakes over the two chrome.* namespaces this module
// touches — captured listeners are invoked directly (never a real
// EventTarget), which is enough to exercise the ordering/staleness logic
// without reimplementing the browser.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTabToolsLookup,
  startTabSync,
  type TabSyncSession,
  type TabSyncView,
} from "./tab-sync";

type ActivatedListener = (info: { tabId: number }) => void;
type UpdatedListener = (
  tabId: number,
  changeInfo: { url?: string; title?: string; favIconUrl?: string },
  tab: { id: number; title?: string; favIconUrl?: string },
) => void;
type MessageListener = (message: unknown) => void;

interface FakeTab {
  id: number;
  url?: string;
  title?: string;
  favIconUrl?: string;
}

function createFakeChrome() {
  const activated: ActivatedListener[] = [];
  const updated: UpdatedListener[] = [];
  const onMessage: MessageListener[] = [];
  const tabs = new Map<number, FakeTab>();
  let activeTabId: number | undefined;
  let sendMessageImpl: (message: unknown) => Promise<unknown> = () => Promise.resolve(undefined);

  const fakeChrome = {
    tabs: {
      query: vi.fn(async () => {
        const tab = activeTabId !== undefined ? tabs.get(activeTabId) : undefined;
        return tab ? [tab] : [];
      }),
      get: vi.fn(async (id: number) => {
        const tab = tabs.get(id);
        if (!tab) throw new Error("no such tab");
        return tab;
      }),
      onActivated: {
        addListener: (l: ActivatedListener) => activated.push(l),
        removeListener: vi.fn(),
      },
      onUpdated: {
        addListener: (l: UpdatedListener) => updated.push(l),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      sendMessage: vi.fn((message: unknown) => sendMessageImpl(message)),
      onMessage: {
        addListener: (l: MessageListener) => onMessage.push(l),
        // Actually removes, unlike the `chrome.tabs` stubs above: card 129's
        // teardown test needs a torn-down sync to genuinely stop hearing
        // broadcasts, which a no-op `removeListener` would report as a pass
        // for the wrong reason.
        removeListener: (l: MessageListener) => {
          const at = onMessage.indexOf(l);
          if (at >= 0) onMessage.splice(at, 1);
        },
      },
    },
  } as unknown as typeof chrome;

  return {
    chrome: fakeChrome,
    tabs,
    fireActivated(tabId: number) {
      activeTabId = tabId;
      for (const l of activated) l({ tabId });
    },
    fireUpdated(tabId: number, changeInfo: { url?: string; title?: string; favIconUrl?: string }) {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error("no such tab");
      for (const l of updated) l(tabId, changeInfo, tab);
    },
    fireMessage(message: unknown) {
      for (const l of onMessage) l(message);
    },
    setActive(tabId: number) {
      activeTabId = tabId;
    },
    setSendMessageImpl(fn: (message: unknown) => Promise<unknown>) {
      sendMessageImpl = fn;
    },
  };
}

function makeSession(): TabSyncSession & { syncCalls: [number, string][] } {
  const syncCalls: [number, string][] = [];
  let origin: string | undefined;
  return {
    syncCalls,
    activeTabOrigin: () => origin,
    async syncToTab(tabId, o) {
      syncCalls.push([tabId, o]);
      origin = o;
    },
    async applyNavigation(_tabId, o) {
      origin = o;
    },
  };
}

function makeView(): TabSyncView & {
  resolved: Parameters<TabSyncView["pageResolved"]>[0][];
  toolsChanges: { tabId: number; count: number; available: boolean }[];
  selectionPings: number[];
} {
  const resolved: Parameters<TabSyncView["pageResolved"]>[0][] = [];
  const toolsChanges: { tabId: number; count: number; available: boolean }[] = [];
  const selectionPings: number[] = [];
  return {
    resolved,
    toolsChanges,
    selectionPings,
    pageResolved: (page) => resolved.push(page),
    pageMetaChanged: () => undefined,
    toolsChanged: (tabId, tools, available) =>
      toolsChanges.push({ tabId, count: tools.length, available }),
    selectionMaybeChanged: (tabId) => selectionPings.push(tabId),
  };
}

/** Start a sync with one tab already active and resolved — the state most tests below want to begin from. */
async function startSyncedOnTab(
  fake: ReturnType<typeof createFakeChrome>,
  tabId: number,
): Promise<{ view: ReturnType<typeof makeView>; stop: () => void }> {
  fake.setSendMessageImpl(async () => ({
    type: "runtime:get-tools-response",
    tabId,
    available: true,
    restricted: false,
    tools: [],
  }));
  const view = makeView();
  const stop = startTabSync({ session: makeSession(), view });
  await vi.waitFor(() => expect(view.resolved.length).toBeGreaterThan(0));
  return { view, stop };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chaos: runtime:tools-updated racing a tab switch", () => {
  it("ignores a tools-updated broadcast for a tab that is no longer the active one (e.g. it was closed/switched away from)", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    fake.tabs.set(1, { id: 1, url: "https://a.example.com", title: "A" });
    fake.tabs.set(2, { id: 2, url: "https://b.example.com", title: "B" });
    fake.setActive(1);
    fake.setSendMessageImpl(async () => ({
      type: "runtime:get-tools-response",
      tabId: 1,
      available: true,
      restricted: false,
      tools: [],
    }));
    const session = makeSession();
    const view = makeView();

    const stop = startTabSync({ session, view });
    await vi.waitFor(() => expect(view.resolved.length).toBeGreaterThan(0));

    // The user switches to tab 2 — the adapter's `activeTabId` moves on.
    fake.fireActivated(2);
    await vi.waitFor(() => expect(session.syncCalls.some(([id]) => id === 2)).toBe(true));

    // A `runtime:tools-updated` broadcast for the OLD tab (1) arrives late —
    // e.g. the relay was already mid-flight with it when the switch happened.
    fake.fireMessage({
      type: "runtime:tools-updated",
      tabId: 1,
      origin: "https://a.example.com",
      available: true,
      tools: [{ name: "x" }],
    });

    expect(view.toolsChanges).toEqual([]); // never applied — tab 1 is stale
    stop();
  });

  it("applies a tools-updated broadcast delivered twice in a row identically (duplicate message delivery), without throwing or double-counting oddly", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    fake.tabs.set(1, { id: 1, url: "https://a.example.com", title: "A" });
    fake.setActive(1);
    fake.setSendMessageImpl(async () => ({
      type: "runtime:get-tools-response",
      tabId: 1,
      available: true,
      restricted: false,
      tools: [],
    }));
    const session = makeSession();
    const view = makeView();

    const stop = startTabSync({ session, view });
    await vi.waitFor(() => expect(view.resolved.length).toBeGreaterThan(0));

    const message = {
      type: "runtime:tools-updated",
      tabId: 1,
      origin: "https://a.example.com",
      available: true,
      tools: [{ name: "x" }, { name: "y" }],
    };
    fake.fireMessage(message);
    fake.fireMessage(message); // exact duplicate delivery

    expect(view.toolsChanges).toEqual([
      { tabId: 1, count: 2, available: true },
      { tabId: 1, count: 2, available: true },
    ]);
    stop();
  });
});

describe("chaos: the three-state tool availability model stays distinguishable end to end", () => {
  it.each([
    [
      "ordinary page with no tools registered",
      { available: true, restricted: false, tools: [] },
      { available: true, restricted: false, tools: [] },
    ],
    [
      "WebMCP not enabled in this Chrome build",
      { available: false, restricted: false, tools: [] },
      { available: false, restricted: false, tools: [] },
    ],
    [
      "a restricted page (chrome://, the Web Store, ...) — no relay to even ask",
      { available: false, restricted: true, tools: [] },
      { available: false, restricted: true, tools: [] },
    ],
  ])("%s", async (_label, response, expected) => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    fake.tabs.set(1, { id: 1, url: "https://a.example.com", title: "A" });
    fake.setActive(1);
    fake.setSendMessageImpl(async () => ({
      type: "runtime:get-tools-response",
      tabId: 1,
      ...response,
    }));
    const session = makeSession();
    const view = makeView();

    const stop = startTabSync({ session, view });
    await vi.waitFor(() => expect(view.resolved.length).toBeGreaterThan(0));

    expect(view.resolved[0]).toMatchObject(expected);
    stop();
  });

  it("a worker that isn't listening yet (sendMessage rejects) degrades to the SAME defaults as an ordinary page — never flashes 'restricted' for a transient startup gap", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    fake.tabs.set(1, { id: 1, url: "https://a.example.com", title: "A" });
    fake.setActive(1);
    fake.setSendMessageImpl(() =>
      Promise.reject(new Error("Could not establish connection. Receiving end does not exist.")),
    );
    const session = makeSession();
    const view = makeView();

    const stop = startTabSync({ session, view });
    await vi.waitFor(() => expect(view.resolved.length).toBeGreaterThan(0));

    expect(view.resolved[0]).toMatchObject({ available: true, restricted: false, tools: [] });
    stop();
  });
});

describe("chaos: createTabToolsLookup against a wedged or misbehaving worker", () => {
  it("resolves to an empty list (never hangs, never throws) when sendMessage rejects", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    fake.setSendMessageImpl(() => Promise.reject(new Error("no receiver")));

    const lookup = createTabToolsLookup();
    await expect(lookup(1)).resolves.toEqual([]);
  });

  it("resolves to an empty list for a well-formed but malformed-shape response (missing tools field)", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    fake.setSendMessageImpl(async () => ({
      type: "runtime:get-tools-response",
      tabId: 1,
      available: true,
      restricted: false,
    }));

    const lookup = createTabToolsLookup();
    await expect(lookup(1)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The selection ping (card 129, decisions/40's "Live chip updates")
//
// The adapter's whole job for this message is the part the surface cannot do
// itself: hold the `chrome.runtime` listener, and know which tab is on
// screen. It carries no payload, so there is nothing else to get right —
// which is exactly why the tab test below matters.
// ---------------------------------------------------------------------------

describe("runtime:selection-changed", () => {
  it("forwards a ping for the ACTIVE tab to the view, carrying only the tab id", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    fake.tabs.set(1, { id: 1, url: "https://a.example.com", title: "A" });
    fake.setActive(1);
    const { view, stop } = await startSyncedOnTab(fake, 1);

    fake.fireMessage({ type: "runtime:selection-changed", tabId: 1 });

    expect(view.selectionPings).toEqual([1]);
    stop();
  });

  it("drops a ping for a BACKGROUND tab — answering it would be a page read of a tab the user is not looking at", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    fake.tabs.set(1, { id: 1, url: "https://a.example.com", title: "A" });
    fake.tabs.set(2, { id: 2, url: "https://b.example.com", title: "B" });
    fake.setActive(1);
    const { view, stop } = await startSyncedOnTab(fake, 1);

    fake.fireMessage({ type: "runtime:selection-changed", tabId: 2 });

    expect(view.selectionPings).toEqual([]);
    stop();
  });

  it("follows the active tab: after a switch, the NEW tab's pings are the ones that count", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    fake.tabs.set(1, { id: 1, url: "https://a.example.com", title: "A" });
    fake.tabs.set(2, { id: 2, url: "https://b.example.com", title: "B" });
    fake.setActive(1);
    const { view, stop } = await startSyncedOnTab(fake, 1);

    fake.fireActivated(2);
    await vi.waitFor(() => expect(view.resolved.length).toBeGreaterThan(1));

    fake.fireMessage({ type: "runtime:selection-changed", tabId: 1 });
    fake.fireMessage({ type: "runtime:selection-changed", tabId: 2 });

    expect(view.selectionPings).toEqual([2]);
    stop();
  });

  it("stops forwarding once torn down", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    fake.tabs.set(1, { id: 1, url: "https://a.example.com", title: "A" });
    fake.setActive(1);
    const { view, stop } = await startSyncedOnTab(fake, 1);

    stop();
    fake.fireMessage({ type: "runtime:selection-changed", tabId: 1 });

    expect(view.selectionPings).toEqual([]);
  });

  it("ignores a message that is not a runtime message at all, and one of an unrelated type", async () => {
    const fake = createFakeChrome();
    vi.stubGlobal("chrome", fake.chrome);
    fake.tabs.set(1, { id: 1, url: "https://a.example.com", title: "A" });
    fake.setActive(1);
    const { view, stop } = await startSyncedOnTab(fake, 1);

    fake.fireMessage({ type: "something-else", tabId: 1 });
    fake.fireMessage("not an object");
    fake.fireMessage(undefined);

    expect(view.selectionPings).toEqual([]);
    expect(view.toolsChanges).toEqual([]);
    stop();
  });
});

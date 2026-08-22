// The SHARING GATE's rules (card 119, decisions/40-page-context-access.md) —
// the scoping decision this card journalled, and the two contracts card 118
// handed over: an EMPTY snapshot is a success (no chip, no error) and
// `Restricted` is terminal.
//
// Driven against the REAL store, with two fakes underneath it:
//   - the page it is scoped to comes from ./panel.svelte's `tabSyncView`, the
//     same seam src/infra/chrome-runtime/tab-sync.ts writes through in the
//     app, so "the tab navigated" is expressed here exactly as the adapter
//     expresses it;
//   - the port it pulls through is `createFakePageContextSource`
//     (../testing/fake-services), reassigned per test.
//
// One `initFakeSidePanelServices` for the file (that helper's own note
// explains why it cannot be per-test), and `resetPageSharing()` in a
// `beforeEach` for the module-scoped state — the same discipline
// ./notices.svelte.test.ts uses.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PageContextError, type PageContextSnapshot } from "../../domain/chat";
import { fail, ok } from "../../domain/result";
import { createFakeSidePanelServices, initFakeSidePanelServices } from "../testing/fake-services";
import { clearNotices, panelNotices } from "./notices.svelte";
import { tabSyncView } from "./panel.svelte";
import {
  collectTurnContext,
  dismissSelection,
  initPageSharingSync,
  pageSharing,
  refreshSelection,
  resetPageSharing,
  setShareContent,
  setSharing,
} from "./pageSharing.svelte";

const services = createFakeSidePanelServices();

/** Put a page in front of the panel, the way the tab-sync adapter does. */
function showPage(options: { tabId?: number; origin?: string; restricted?: boolean } = {}): void {
  const origin = options.origin ?? "https://example.com";
  tabSyncView.pageResolved({
    tabId: options.tabId ?? 1,
    title: "Example",
    origin,
    tools: [],
    available: true,
    restricted: options.restricted ?? false,
  });
}

function snapshot(text: string, overrides: Partial<PageContextSnapshot> = {}): PageContextSnapshot {
  return {
    mode: "selection",
    text,
    url: "https://example.com/",
    title: "Example",
    truncated: false,
    bytes: text.length,
    ...overrides,
  };
}

/** A source that answers `text` for every pull, and counts how often it was asked. */
function sourceAnswering(text: string): { pull: ReturnType<typeof vi.fn> } {
  const pull = vi.fn(async (_tabId: number, mode: PageContextSnapshot["mode"]) =>
    ok(snapshot(text, { mode })),
  );
  services.pageContext = { pull };
  return { pull };
}

beforeAll(() => {
  initFakeSidePanelServices(services);
});

beforeEach(() => {
  resetPageSharing();
  clearNotices();
  services.pageContext = createFakeSidePanelServices().pageContext;
  showPage();
});

describe("the sharing gate", () => {
  it("shares by default — a page nobody has touched is a page the panel can see", () => {
    expect(pageSharing.sharing).toBe(true);
  });

  it("still reads as sharing before any tab has resolved, so the chip never flashes a dismissed state at startup", () => {
    resetPageSharing();
    tabSyncView.pageResolved({
      tabId: 1,
      title: "",
      origin: "https://example.com",
      tools: [],
      available: true,
      restricted: false,
    });
    expect(pageSharing.sharing).toBe(true);
  });

  it("dismisses and re-enables", () => {
    setSharing(false);
    expect(pageSharing.sharing).toBe(false);
    setSharing(true);
    expect(pageSharing.sharing).toBe(true);
  });

  describe("scope", () => {
    it("resets to sharing when the SAME TAB navigates to a different origin", () => {
      setSharing(false);
      showPage({ tabId: 1, origin: "https://other.example" });
      expect(pageSharing.sharing).toBe(true);
    });

    it("remembers the dismissal when that tab comes back to the same origin", () => {
      setSharing(false);
      showPage({ tabId: 1, origin: "https://other.example" });
      showPage({ tabId: 1, origin: "https://example.com" });
      expect(pageSharing.sharing).toBe(false);
    });

    it("does not blind ANOTHER TAB on the same origin", () => {
      setSharing(false);
      showPage({ tabId: 2, origin: "https://example.com" });
      expect(pageSharing.sharing).toBe(true);
    });
  });
});

describe("the share-page-content toggle", () => {
  it("is off until asked for", () => {
    expect(pageSharing.shareContent).toBe(false);
  });

  it("turns on and off for the page on screen", () => {
    setShareContent(true);
    expect(pageSharing.shareContent).toBe(true);
    setShareContent(false);
    expect(pageSharing.shareContent).toBe(false);
  });

  it("is subordinate to the gate: reads off while sharing is dismissed", () => {
    setShareContent(true);
    setSharing(false);
    expect(pageSharing.shareContent).toBe(false);
  });

  it("cannot be switched on behind a dismissed gate, and does not come back when sharing does", () => {
    setShareContent(true);
    setSharing(false);
    setShareContent(true);
    setSharing(true);
    expect(pageSharing.shareContent).toBe(false);
  });

  it("is per page: opting this page's text in says nothing about the next page's", () => {
    setShareContent(true);
    showPage({ tabId: 1, origin: "https://other.example" });
    expect(pageSharing.shareContent).toBe(false);
  });
});

describe("the selection chip", () => {
  it("offers nothing for an EMPTY selection — a success, not an error (card 118)", async () => {
    sourceAnswering("");
    await refreshSelection();
    expect(pageSharing.selection).toBeUndefined();
    expect(panelNotices.all).toHaveLength(0);
  });

  it("offers the selection when there is one", async () => {
    sourceAnswering("the quick brown fox");
    await refreshSelection();
    expect(pageSharing.selection?.text).toBe("the quick brown fox");
  });

  it("says nothing when the pull fails — nobody asked for this one", async () => {
    services.pageContext = {
      pull: async () => fail(new PageContextError("Unreachable", "no relay")),
    };
    await refreshSelection();
    expect(pageSharing.selection).toBeUndefined();
    expect(panelNotices.all).toHaveLength(0);
  });

  it("never pulls at all while sharing is dismissed", async () => {
    const { pull } = sourceAnswering("something");
    setSharing(false);
    await refreshSelection();
    expect(pull).not.toHaveBeenCalled();
    expect(pageSharing.selection).toBeUndefined();
  });

  it("never pulls from a restricted page", async () => {
    const { pull } = sourceAnswering("something");
    showPage({ restricted: true });
    await refreshSelection();
    expect(pull).not.toHaveBeenCalled();
  });

  it("drops a pulled selection outright when sharing is dismissed", async () => {
    sourceAnswering("visible");
    await refreshSelection();
    setSharing(false);
    expect(pageSharing.selection).toBeUndefined();
  });

  it("belongs to the page it was pulled for — a tab switch hides it", async () => {
    sourceAnswering("on tab one");
    await refreshSelection();
    showPage({ tabId: 2 });
    expect(pageSharing.selection).toBeUndefined();
  });

  it("drops an answer that arrives after the panel has moved on", async () => {
    let settle: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (settle = resolve));
    services.pageContext = {
      pull: async () => {
        await gate;
        return ok(snapshot("late answer"));
      },
    };
    const pending = refreshSelection();
    showPage({ tabId: 2 });
    settle?.();
    await pending;
    showPage({ tabId: 1 });
    expect(pageSharing.selection).toBeUndefined();
  });

  describe("dismissal", () => {
    it("hides THAT selection, including on the next pull", async () => {
      sourceAnswering("dismiss me");
      await refreshSelection();
      dismissSelection();
      expect(pageSharing.selection).toBeUndefined();

      await refreshSelection();
      expect(pageSharing.selection).toBeUndefined();
    });

    it("offers a chip again once the user highlights something else", async () => {
      sourceAnswering("dismiss me");
      await refreshSelection();
      dismissSelection();

      sourceAnswering("but not this");
      await refreshSelection();
      expect(pageSharing.selection?.text).toBe("but not this");
    });
  });
});

describe("what goes with the turn", () => {
  it("attaches nothing, and pulls nothing, while sharing is dismissed", async () => {
    const { pull } = sourceAnswering("selected text");
    setShareContent(true);
    setSharing(false);

    expect(await collectTurnContext()).toEqual([]);
    expect(pull).not.toHaveBeenCalled();
  });

  it("attaches the selection and consumes the chip", async () => {
    sourceAnswering("selected text");
    await refreshSelection();

    const attached = await collectTurnContext();

    expect(attached.map((s) => s.text)).toEqual(["selected text"]);
    expect(pageSharing.selection).toBeUndefined();
  });

  it("re-reads the selection at send rather than trusting the chip", async () => {
    sourceAnswering("stale");
    await refreshSelection();
    sourceAnswering("what is actually selected now");

    const attached = await collectTurnContext();

    expect(attached.map((s) => s.text)).toEqual(["what is actually selected now"]);
  });

  it("attaches nothing when the selection was dismissed, even though the page still has one", async () => {
    sourceAnswering("selected text");
    await refreshSelection();
    dismissSelection();

    expect(await collectTurnContext()).toEqual([]);
  });

  it("puts the selection before the page extract", async () => {
    services.pageContext = {
      pull: async (_tabId, mode) =>
        ok(snapshot(mode === "selection" ? "the selection" : "the whole page", { mode })),
    };
    setShareContent(true);

    const attached = await collectTurnContext();

    expect(attached.map((s) => s.mode)).toEqual(["selection", "extract"]);
    expect(attached.map((s) => s.text)).toEqual(["the selection", "the whole page"]);
  });

  it("keeps the content toggle on across a send — it is a standing choice about the page", async () => {
    sourceAnswering("page text");
    setShareContent(true);
    await collectTurnContext();
    expect(pageSharing.shareContent).toBe(true);
  });

  it("attaches nothing for an empty extract", async () => {
    sourceAnswering("");
    setShareContent(true);
    expect(await collectTurnContext()).toEqual([]);
  });

  it("carries the truncation flag through to the caller", async () => {
    services.pageContext = {
      pull: async (_tabId, mode) =>
        ok(snapshot(mode === "extract" ? "a very long page" : "", { mode, truncated: true })),
    };
    setShareContent(true);

    const [extract] = await collectTurnContext();

    expect(extract?.truncated).toBe(true);
  });

  it("says so when the page text the user asked for could not be read", async () => {
    services.pageContext = {
      pull: async () => fail(new PageContextError("Unreachable", "no relay")),
    };
    setShareContent(true);

    expect(await collectTurnContext()).toEqual([]);
    expect(panelNotices.all).toHaveLength(1);
  });

  it("uses the terminal wording for a restricted page, not the try-again one", async () => {
    services.pageContext = {
      pull: async () => fail(new PageContextError("Restricted", "chrome://")),
    };
    setShareContent(true);
    await collectTurnContext();
    const restrictedNotice = panelNotices.all[0]?.message;

    clearNotices();
    services.pageContext = {
      pull: async () => fail(new PageContextError("Unreachable", "no relay")),
    };
    await collectTurnContext();

    expect(restrictedNotice).toBeDefined();
    expect(panelNotices.all[0]?.message).not.toBe(restrictedNotice);
  });
});

// ---------------------------------------------------------------------------
// CARD 120's CHAOS CASES: what happens between the chip appearing and Send
// actually landing. The send-time re-pull already made sending stale text
// impossible; these pin that the user is TOLD, and that a gesture made during
// the pull is honoured by the turn it was made during.
// ---------------------------------------------------------------------------

describe("what changes between the chip and the send", () => {
  it("drops a selection the page has navigated away from, and says so", async () => {
    sourceAnswering("what I highlighted on the old page");
    await refreshSelection();
    expect(pageSharing.selection).toBeDefined();

    // The navigation: the browser's own selection is gone, so the send-time
    // pull comes back empty (card 118: a SUCCESS, not an error).
    sourceAnswering("");

    expect(await collectTurnContext()).toEqual([]);
    expect(panelNotices.all).toHaveLength(1);
    expect(pageSharing.selection).toBeUndefined();
  });

  it("says so for a CROSS-ORIGIN navigation too, where the chip's snapshot belongs to another key", async () => {
    sourceAnswering("highlighted on example.com");
    await refreshSelection();

    showPage({ tabId: 1, origin: "https://elsewhere.example" });
    sourceAnswering("");

    expect(await collectTurnContext()).toEqual([]);
    expect(panelNotices.all).toHaveLength(1);
  });

  it("stays quiet when the user dismissed the chip themselves — that is not staleness", async () => {
    sourceAnswering("selected text");
    await refreshSelection();
    dismissSelection();

    expect(await collectTurnContext()).toEqual([]);
    expect(panelNotices.all).toHaveLength(0);
  });

  it("stays quiet when there was never a chip to lose", async () => {
    sourceAnswering("");

    expect(await collectTurnContext()).toEqual([]);
    expect(panelNotices.all).toHaveLength(0);
  });

  it("stays quiet when the selection is still there — the fresh read simply replaces it", async () => {
    sourceAnswering("first");
    await refreshSelection();
    sourceAnswering("second");

    const attached = await collectTurnContext();

    expect(attached.map((s) => s.text)).toEqual(["second"]);
    expect(panelNotices.all).toHaveLength(0);
  });

  it("attaches nothing at all once sharing is dismissed between the chip and the send", async () => {
    const { pull } = sourceAnswering("selected text");
    await refreshSelection();
    setSharing(false);

    expect(await collectTurnContext()).toEqual([]);
    // One pull, the one that produced the chip — the send made none.
    expect(pull).toHaveBeenCalledTimes(1);
    expect(panelNotices.all).toHaveLength(0);
  });

  it("honours a dismissal made WHILE the page text is being pulled", async () => {
    // The nearest thing to "dismissed mid-turn" this seam can express: the
    // gesture lands after `collectTurnContext` has already checked the gate
    // and gone to the page. The gate is re-read when the answer comes back,
    // so nothing new is attached.
    let releaseExtract: (() => void) | undefined;
    services.pageContext = {
      pull: async (_tabId, mode) => {
        if (mode === "selection") return ok(snapshot("", { mode }));
        await new Promise<void>((resolve) => {
          releaseExtract = resolve;
        });
        return ok(snapshot("the whole page", { mode }));
      },
    };
    setShareContent(true);

    const collecting = collectTurnContext();
    await vi.waitFor(() => expect(releaseExtract).toBeDefined());
    setSharing(false);
    releaseExtract?.();

    expect(await collecting).toEqual([]);
  });

  it("drops a page extract that arrives after the panel has moved to another page", async () => {
    let releaseExtract: (() => void) | undefined;
    services.pageContext = {
      pull: async (_tabId, mode) => {
        if (mode === "selection") return ok(snapshot("", { mode }));
        await new Promise<void>((resolve) => {
          releaseExtract = resolve;
        });
        return ok(snapshot("text from the page we left", { mode }));
      },
    };
    setShareContent(true);

    const collecting = collectTurnContext();
    await vi.waitFor(() => expect(releaseExtract).toBeDefined());
    showPage({ tabId: 2, origin: "https://elsewhere.example" });
    releaseExtract?.();

    expect(await collecting).toEqual([]);
  });
});

describe("the focus sync", () => {
  it("re-reads the selection when the panel takes focus", async () => {
    const { pull } = sourceAnswering("highlighted while the panel was away");
    const teardown = initPageSharingSync();

    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(pull).toHaveBeenCalledTimes(1));
    expect(pageSharing.selection?.text).toBe("highlighted while the panel was away");

    teardown();
  });

  it("stops listening once torn down", async () => {
    const { pull } = sourceAnswering("something");
    initPageSharingSync()();

    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();

    expect(pull).not.toHaveBeenCalled();
  });

  it("takes no reading of its own accord — the listener is all it installs", () => {
    const { pull } = sourceAnswering("something");
    const teardown = initPageSharingSync();

    expect(pull).not.toHaveBeenCalled();

    teardown();
  });
});

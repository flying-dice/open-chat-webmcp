// The `chrome.tabs`/`chrome.runtime` DRIVING adapter that keeps a surface in
// step with whichever tab is active (card 78; this is
// src/sidepanel/services/activeTab.ts, relocated).
//
// Card 77 moved the CONSEQUENCE of a tab switch into src/domain/chat — what a
// switch or a navigation means for the conversation is a rule about a
// conversation. What was left behind was the LISTENING: twenty `chrome.tabs`
// and `chrome.runtime` call sites sitting in a UI-layer service, which is
// what kept `ui-does-not-import-infra` parked. The logic below is unchanged
// from that module — the serialization queue, the `isStillActive` staleness
// checks, the swap-before-tools ordering, the tools-lookup timeout — it is
// the same code with its two collaborators turned into arguments:
//
//   `session` — three `ChatService` methods (src/domain/chat) the swap needs.
//               Declared here as a narrow structural interface so this
//               adapter depends on three method signatures rather than on
//               the whole driving port; `ChatService` satisfies it as is.
//   `view`    — where the resolved page lands. Domain-typed
//               (`SerializedTool`, src/domain/tools) plus plain numbers and
//               strings; nothing about the panel's own `PageInfo` shape
//               crosses into this folder, so the store keeps owning it.
//
// Tool counts (and, for card 11's inspector, the full descriptors) come from
// the background service worker's registry (src/background/sw.ts) via the
// shared request/response pair in ./protocol.ts (`runtime:get-tools` /
// `runtime:get-tools-response`), never by talking to a tab's content script
// directly.

import type { SerializedTool } from "../../domain/tools";
import { isRuntimeMessage } from "./protocol";
import type { RuntimeGetToolsResponse } from "./protocol";

/**
 * The three `ChatService` methods a tab swap drives (src/domain/chat).
 * Structural on purpose: this adapter decides only WHEN a tab switch or a
 * real navigation happened, and hands that fact to whatever owns the
 * conversation.
 */
export interface TabSyncSession {
  /** The tab's REAL current origin, set only by a prior swap. */
  activeTabOrigin(): string | undefined;
  /** A real tab switch: resolve that tab's own persisted chat. */
  syncToTab(tabId: number, origin: string): Promise<void>;
  /** A same-tab cross-origin navigation: retire the current chat, start a fresh one. */
  applyNavigation(tabId: number, origin: string): Promise<void>;
}

/** Everything one completed refresh knows about the active tab. The surface turns this into whatever display state it keeps. */
export interface ResolvedPage {
  tabId: number;
  title: string;
  origin: string;
  favIconUrl?: string | undefined;
  tools: SerializedTool[];
  /** Whether `document.modelContext` exists on this tab at all — see `RuntimeToolsUpdatedMessage.available` in ./protocol.ts. */
  available: boolean;
  /** Whether the worker could not reach ANY content relay in this tab — see `RuntimeGetToolsResponse.restricted` in ./protocol.ts. */
  restricted: boolean;
}

/** Where a refresh's results land. Implemented by the surface (the side panel's view store), wired by its composition root. */
export interface TabSyncView {
  /** A full refresh completed for `page.tabId`. */
  pageResolved(page: ResolvedPage): void;
  /**
   * A bare title/favicon update on the active tab, with no navigation and no
   * tools lookup. Deliberately carries no `tabId`: the caller has already
   * established this is the active tab, and the pre-card-78 code merged these
   * two fields into whatever page it was displaying.
   */
  pageMetaChanged(meta: { title: string; favIconUrl?: string | undefined }): void;
  /** The worker pushed a new tool list for `tabId` (its `runtime:tools-updated` broadcast). */
  toolsChanged(tabId: number, tools: SerializedTool[], available: boolean): void;
  /**
   * The worker pushed a content-free `runtime:selection-changed` ping for
   * `tabId` — the relay noticed the page's selection settle on something
   * different (card 129, decisions/40's "Live chip updates").
   *
   * Says only THAT it changed, never what to: the surface answers by making
   * its own gated page-context pull, which is where every consent rule lives.
   * This adapter's contribution is the one thing the surface cannot do for
   * itself — hold the `chrome.runtime` listener, and know whether the ping is
   * about the tab currently on screen.
   *
   * On the panel this is wired to `notifySelectionMaybeChanged` in
   * src/sidepanel/stores/pageSharing.svelte.ts, NOT to the page store the
   * other three methods land in: the sharing gate is a different store, and
   * the composition root is the one place allowed to know both. (The page
   * store could not implement it anyway — it is what pageSharing reads to
   * find the current page, so the import would be a cycle.)
   */
  selectionMaybeChanged(tabId: number): void;
}

export interface TabSyncOptions {
  session: TabSyncSession;
  view: TabSyncView;
  /**
   * Sync-path tracing (decisions/25, card 59). Every branch that can drop a
   * session returns silently, and the only thing that ever cracked one of
   * those cases was a hand-dumped storage snapshot — this makes the branch
   * actually taken visible in the console. Gated by the caller on the stored
   * tracing flag (src/infra/chrome-storage/debug-flags.ts); defaults to a
   * no-op so a caller that does not want it pays nothing.
   */
  trace?: (...args: unknown[]) => void;
}

/** Best-effort origin for a tab URL. `chrome://`, `about:blank`, and a still-loading tab (no URL yet) all fall back to an empty string rather than throwing. */
function originOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * How long {@link getToolsAndAvailabilityForTab} waits for the worker before
 * giving up (decisions/25 §1, card 57). MV3 tears an idle worker down after
 * ~30s, and the side panel is exactly what wakes it back up — a
 * `sendMessage` sent while it's cold-starting, or torn down mid-message, can
 * leave its promise unsettled forever rather than rejecting, which a plain
 * `try/catch` cannot catch. Tool info is enrichment (decision 25's framing),
 * so a wedged worker must degrade the tool count, never hang the panel.
 */
const GET_TOOLS_TIMEOUT_MS = 1500;

/** Distinguishes "the timer won the race" from "the worker actually replied" below — a plain `undefined` sentinel would be ambiguous with a genuinely malformed (but present) response, and the trace needs to log the timeout specifically, not just infer it from an empty-looking result. */
const TOOLS_LOOKUP_TIMED_OUT = Symbol("tools-lookup-timed-out");

// TODO: clean-code - 0.25 - SRP: createTabToolsLookup (a standalone per-turn tool lookup used by chatTurn.ts) and the full active-tab-tracking/session-swap engine (startTabSync) share this file and this helper — two different callers' concerns bundled together. STAYS: both answer "what does chrome.tabs say about the active tab right now", and the helper they share is that single query. Splitting them duplicates the query into two adapter modules that may not import each other (guard:boundaries), which trades one shared helper for two copies of the thing actually worth having once.
async function getToolsAndAvailabilityForTab(
  tabId: number,
  trace: (...args: unknown[]) => void,
): Promise<{ tools: SerializedTool[]; available: boolean; restricted: boolean }> {
  try {
    // Raced against a timer, not just awaited directly: a `sendMessage` to a
    // cold-starting or killed-mid-call worker can leave this promise
    // unsettled rather than rejecting (see GET_TOOLS_TIMEOUT_MS's doc
    // comment), so `await` alone would hang the whole tab sync on it. The
    // timeout resolves `TOOLS_LOOKUP_TIMED_OUT`, which lands on the exact
    // same "unexpected shape" fallback below as an actual malformed
    // response — no separate handling needed beyond the trace call. The
    // losing `sendMessage` promise is left to settle on its own; discarding
    // the race here does not cancel it.
    //
    // CAST on the race's result: `chrome.runtime.sendMessage` resolves `any`
    // in @types/chrome (the API is genuinely untyped — what comes back is
    // whatever the listener returned), which would make the whole race `any`
    // and leak it through this function. Naming the three outcomes is what
    // stops that: the worker's answer, the timer's sentinel, or `undefined`
    // when no listener replied. Nothing below trusts it — every field is
    // read through `?.` with a default.
    const response = (await Promise.race([
      chrome.runtime.sendMessage({ type: "runtime:get-tools", tabId }),
      new Promise<typeof TOOLS_LOOKUP_TIMED_OUT>((resolve) =>
        setTimeout(() => resolve(TOOLS_LOOKUP_TIMED_OUT), GET_TOOLS_TIMEOUT_MS),
      ),
    ])) as RuntimeGetToolsResponse | typeof TOOLS_LOOKUP_TIMED_OUT | undefined;
    if (response === TOOLS_LOOKUP_TIMED_OUT) trace("tools-timeout", { tabId });
    const resolved = response === TOOLS_LOOKUP_TIMED_OUT ? undefined : response;
    // Worker not reachable yet, timed out, or answered with an unexpected
    // shape — default `available: true, restricted: false` so a transient
    // startup gap doesn't flash "WebMCP unavailable"/"restricted page" for
    // an ordinary page.
    return {
      tools: resolved?.tools ?? [],
      available: resolved?.available ?? true,
      restricted: resolved?.restricted ?? false,
    };
  } catch (err) {
    // No listener yet (worker still starting) — treat as "no tools known".
    trace("tools-lookup-rejected", { tabId, err });
    return { tools: [], available: true, restricted: false };
  }
}

/**
 * The tab-tools lookup on its own, for a caller that needs a tab's current
 * page tools without driving a whole refresh — the side panel's per-turn
 * `ToolExecutor` (src/sidepanel/services/chatTurn.ts) attaches exactly this
 * list to a turn.
 */
export function createTabToolsLookup(opts?: {
  trace?: (...args: unknown[]) => void;
}): (tabId: number) => Promise<SerializedTool[]> {
  const trace = opts?.trace ?? (() => undefined);
  return async (tabId: number) => (await getToolsAndAvailabilityForTab(tabId, trace)).tools;
}

/**
 * Refresh the view for `tabId`, and keep the conversation pointed at the
 * right history (decision 07):
 *   - a real tab switch (`isNewTab`) loads-or-creates *that tab's own*
 *     persisted session — it may already have history, and switching tabs
 *     must swap to it rather than resetting ("switching tabs swaps the
 *     visible session; it never merges histories").
 *   - a same-tab cross-origin navigation resets the session (the old
 *     conversation refers to tools/page state that no longer exist);
 *     same-origin is a no-op.
 *
 * ORDERING (decisions/25 §1, card 57): the session swap runs immediately
 * after `chrome.tabs.get` resolves, BEFORE the tools lookup below it —
 * restoring the transcript has zero dependency on tool information, and the
 * tools lookup is the one call in this function that can be slow (a cold or
 * killed MV3 worker). Gating the swap behind it meant a wedged worker could
 * block the transcript from ever restoring; now a wedged worker only costs
 * the tool count and the context chip.
 *
 * `isStillActive` guards against a stale result clobbering a newer one: this
 * function `await`s three times (`chrome.tabs.get`, the swap, then the tools
 * lookup) before touching the shared state each one owns, so a rapid
 * A → B → A tab switch can leave two overlapping calls in flight with no
 * ordering guarantee. Callers report whether `tabId` is still the active
 * tab; the check is re-run after each `await` and the call bails out the
 * moment it goes stale (card 54) — see also `startTabSync`'s call-site
 * serialization, which additionally prevents an `onActivated` and an
 * `onUpdated` for the SAME tab from interleaving in the first place
 * (decisions/25 §2), something an identity check alone cannot do.
 */
async function refreshActiveTab(
  opts: TabSyncOptions & { trace: (...args: unknown[]) => void },
  tabId: number,
  isNewTab: boolean,
  isStillActive: () => boolean,
): Promise<void> {
  const { session, view, trace } = opts;
  trace("refreshActiveTab enter", { tabId, isNewTab });
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab || tab.id !== tabId) {
    trace("refreshActiveTab exit", { tabId, reason: "no-tab" });
    return;
  }
  if (!isStillActive()) {
    trace("refreshActiveTab exit", { tabId, reason: "stale-after-get" });
    return;
  }

  const origin = originOf(tab.url);
  // Sourced from the session's own `activeTabOrigin()` (the tab's REAL
  // current origin, set only by a prior swap), never from the view's page
  // state — that is display state written AFTER a swap already applied, so it
  // lags by one microtask. An `onUpdated` racing an in-flight `onActivated`
  // for the same tab could otherwise read a not-yet-updated origin, wrongly
  // conclude the tab navigated, and fabricate a spurious empty chat
  // (decisions/25 §2).
  const previousOrigin = isNewTab ? undefined : session.activeTabOrigin();

  if (isNewTab) {
    await session.syncToTab(tabId, origin);
  } else if (previousOrigin !== origin) {
    await session.applyNavigation(tabId, origin);
  }
  if (!isStillActive()) {
    trace("refreshActiveTab exit", { tabId, reason: "stale-before-apply" });
    return;
  }

  const { tools, available, restricted } = await getToolsAndAvailabilityForTab(tabId, trace);
  if (!isStillActive()) {
    trace("refreshActiveTab exit", { tabId, reason: "stale-before-apply" });
    return;
  }

  view.pageResolved({
    tabId,
    title: tab.title ?? "",
    origin,
    favIconUrl: tab.favIconUrl,
    tools,
    available,
    restricted,
  });
  trace("refreshActiveTab applied", { tabId, toolCount: tools.length });
}

/**
 * Wires the `chrome.tabs`/`chrome.runtime` listeners that keep a surface's
 * page state (and, on a tab switch or cross-origin navigation, the
 * transcript) in sync with the active tab. Call once from a composition root;
 * returns a cleanup function that removes all listeners.
 *
 * Every `refreshActiveTab` call goes through one module-local promise chain
 * (decisions/25 §2, card 57) — the exact `withIndexLock` shape the chat
 * store's index queue already uses (src/infra/chrome-storage/chat-store.ts),
 * reused rather than reinvented. `isStillActive` (card 54) is an identity
 * check: it can tell a stale call "you're no longer for the active tab", but
 * it structurally cannot separate an `onActivated` and an `onUpdated` that
 * both target the SAME (still-active) tab and happen to overlap — both would
 * pass the identity check, and whichever's `await`s interleave last would win
 * nondeterministically. The queue gives them a total order matching the order
 * the browser actually fired the events in, one full refresh at a time. NOT
 * reentrant, same caveat as `withIndexLock` — nothing here calls back into
 * the lock from inside `fn`, so that doesn't arise.
 *
 * Note: these listeners aren't scoped to a `windowId`, so a tab activation
 * in an unrelated browser window could in theory also reach `activeTabId`
 * here in a multi-window setup. Rarer than the single-window rapid-switch
 * race `isStillActive` fixes (card 54) — not addressed here.
 */
export function startTabSync(options: TabSyncOptions): () => void {
  const trace = options.trace ?? (() => undefined);
  const opts = { ...options, trace };
  const { view } = opts;

  let activeTabId: number | undefined;
  let refreshQueue: Promise<void> = Promise.resolve();

  function withRefreshLock(fn: () => Promise<void>): Promise<void> {
    const run = refreshQueue.then(fn, fn);
    refreshQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  void withRefreshLock(async () => {
    const tab = await getActiveTab();
    if (tab?.id === undefined) return;
    activeTabId = tab.id;
    await refreshActiveTab(opts, tab.id, true, () => activeTabId === tab.id);
  });

  const onActivated = (info: chrome.tabs.OnActivatedInfo) => {
    trace("onActivated", { tabId: info.tabId });
    activeTabId = info.tabId;
    void withRefreshLock(() =>
      refreshActiveTab(opts, info.tabId, true, () => activeTabId === info.tabId),
    );
  };

  const onUpdated = (
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab,
  ) => {
    // Logged for every tab, not just the active one (before the guard
    // below) — decisions/25 §2's race is specifically an `onActivated` and
    // an `onUpdated` interleaving for the SAME tab, so seeing an ignored
    // event's tabId/url is part of what makes that race visible in the log.
    trace("onUpdated", { tabId, url: changeInfo.url, isActiveTab: tabId === activeTabId });
    if (tabId !== activeTabId) return;

    // Same gate the worker's own registry uses: only a real URL change
    // means "tools may now be stale" (decisions/02). A bare title update
    // (SPA setting document.title) does not warrant a transcript reset —
    // just refresh the displayed title in place.
    if (changeInfo.url !== undefined) {
      void withRefreshLock(() => refreshActiveTab(opts, tabId, false, () => activeTabId === tabId));
      return;
    }
    // A favicon can arrive after the title (or replace it later), and both
    // land here as a bare update with no URL change.
    if (changeInfo.title !== undefined || changeInfo.favIconUrl !== undefined) {
      view.pageMetaChanged({ title: tab.title ?? "", favIconUrl: tab.favIconUrl });
    }
  };

  // The worker's two one-way broadcasts about the active tab
  // (src/background/sw.ts): live tool-count updates as pages
  // register/deregister tools, without waiting for the panel to re-poll; and
  // card 129's content-free "the selection settled on something else" ping.
  // One listener for both — they arrive on the same channel and need the same
  // active-tab test, and a second `chrome.runtime.onMessage` registration
  // would be a second thing to remember to tear down.
  const onMessage = (message: unknown) => {
    if (!isRuntimeMessage(message)) return;
    // Both broadcasts are scoped to the tab on screen here rather than in the
    // surface: a push for a background tab is not news to a panel that is not
    // showing it, and (for the selection ping) answering one would be a page
    // read of a tab the user is not looking at.
    if (message.type === "runtime:tools-updated") {
      if (message.tabId !== activeTabId) return;
      view.toolsChanged(message.tabId, message.tools, message.available);
      return;
    }
    if (message.type === "runtime:selection-changed") {
      trace("selection-changed", {
        tabId: message.tabId,
        isActiveTab: message.tabId === activeTabId,
      });
      if (message.tabId !== activeTabId) return;
      view.selectionMaybeChanged(message.tabId);
    }
  };

  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.runtime.onMessage.addListener(onMessage);

  return () => {
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.runtime.onMessage.removeListener(onMessage);
  };
}

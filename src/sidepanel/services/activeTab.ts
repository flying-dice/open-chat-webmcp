// Keeps the panel store's `pageInfo` in sync with whichever tab is active,
// and reacts to that tab navigating (decisions/01, decisions/02: tools and
// page identity are per-tab). This is the only file in the side panel that
// talks `chrome.tabs`/`chrome.runtime` directly — components read the
// result off src/sidepanel/stores/panel.svelte.ts instead.
//
// The SESSION SWAP it drives is `ChatService`'s (src/domain/chat): this module
// decides only WHEN a tab switch or a real navigation happened; what that
// means for the conversation (resolve the tab's pointer, or retire the current
// chat and start a fresh one) is a rule about a conversation and lives with
// one. Before card 77 both halves were in the panel store.
//
// Tool counts (and, for card 11's inspector, the full descriptors — name,
// description, annotations, inputSchema) come from the background
// service worker's registry (src/background/sw.ts) via the shared
// request/response pair in src/infra/chrome-runtime/protocol.ts (`runtime:get-tools` /
// `runtime:get-tools-response`), never by talking to a tab's content script
// directly. `setPageInfo`/`setTools` on initial fetch and `setToolCount`/
// `setTools` on the worker's live `runtime:tools-updated` broadcast keep
// both in step with the same source.

import type { RuntimeGetToolsResponse, SerializedTool } from "../../infra/chrome-runtime";
import { isRuntimeMessage } from "../../infra/chrome-runtime";
import { tracingFlag } from "../../infra/chrome-storage";
import { chat, panel, setPageInfo, setToolCount, setTools } from "../stores/panel.svelte";

/**
 * Sync-path tracing (decisions/25, card 59, boards/project-backlog/59-sync-path-diagnostics-and-durability.md).
 * Cards 54/55/57/58 were each a full diagnostic cycle because every branch
 * that can drop a session returns silently — the only thing that ever
 * cracked one was a hand-dumped `chrome.storage.local` snapshot, and card
 * 57's dump proved storage can be perfectly healthy while the screen is
 * still wrong. This makes the branch actually taken visible in the console
 * the next time it happens.
 *
 * Gated on the stored `tracingFlag` (src/infra/chrome-storage/debug-flags.ts —
 * card 77 moved it there out of the panel store, which was the last
 * `chrome.storage` call site outside that folder), NOT a bare
 * `import.meta.env.DEV` check — an earlier version of this card used DEV
 * alone and that was wrong: Vite ties `import.meta.env.DEV` to the
 * serve-vs-build COMMAND, never to `--mode`, so it is `false` in every
 * artifact that can be loaded unpacked, including `npm run build`'s
 * `dist/` — which is exactly what `npm run launch`
 * (scripts/launch-chrome.mjs) builds and opens in Jonathan's real, everyday
 * Chrome. A DEV-only gate would make this tracing permanently dead in the
 * one browser "make the next occurrence self-explaining" actually has to
 * work in. The flag still DEFAULTS to `import.meta.env.DEV` (on
 * while developing, off in a shipped build, so this doesn't spam the
 * console of every ordinary install by default — it fires on every tab
 * event and would otherwise be far chattier than the existing unconditional
 * `[webmcp][sw]`/`[webmcp][relay]` lifecycle/error logs, src/background/sw.ts,
 * src/content/relay.ts, this reuses the prefix convention from, which never
 * needed an on/off gate because they only log on real transitions or actual
 * failures, not on every routine event) — but it can also be switched on at
 * RUNTIME, with no rebuild, from the side panel's own devtools console:
 *
 *   window.__webmcpPanelDebug.enableTracing()
 *
 * See src/infra/chrome-storage/debug-flags.ts for the full story, and
 * scripts/dump-chat-storage.js's header for the same one-liner repeated where
 * it's actually needed.
 */
function trace(...args: unknown[]): void {
  if (tracingFlag.isEnabled()) console.log("[webmcp][tab-sync]", ...args);
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

/** Exported for src/sidepanel/services/chatTurn.ts, whose `ToolExecutor` needs the same tab-tools lookup to attach page tools to a turn. */
export async function getToolsForTab(tabId: number): Promise<SerializedTool[]> {
  return (await getToolsAndAvailabilityForTab(tabId)).tools;
}

/**
 * How long {@link getToolsAndAvailabilityForTab} waits for the worker before
 * giving up (decisions/25 §1, card 57). MV3 tears an idle worker down after
 * ~30s, and this side panel is exactly what wakes it back up — a
 * `sendMessage` sent while it's cold-starting, or torn down mid-message, can
 * leave its promise unsettled forever rather than rejecting, which a plain
 * `try/catch` cannot catch. Tool info is enrichment (decision 25's framing),
 * so a wedged worker must degrade the tool count, never hang the panel.
 */
const GET_TOOLS_TIMEOUT_MS = 1500;

/**
 * Same lookup as {@link getToolsForTab}, but also reports the worker's
 * `available`/`restricted` signals (see RuntimeGetToolsResponse.restricted's
 * doc comment in src/infra/chrome-runtime/protocol.ts, card 31) — `refreshActiveTab` below
 * needs all three to fill in `PageInfo.webmcpAvailable`/`restricted`
 * distinctly from an ordinary zero-tool page.
 */
/** Distinguishes "the timer won the race" from "the worker actually replied" below — a plain `undefined` sentinel would be ambiguous with a genuinely malformed (but present) response, and item 1 needs to log the timeout specifically, not just infer it from an empty-looking result. */
const TOOLS_LOOKUP_TIMED_OUT = Symbol("tools-lookup-timed-out");

async function getToolsAndAvailabilityForTab(
  tabId: number,
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
    // an ordinary page (see PageInfo.webmcpAvailable's doc comment).
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
 * Refresh `pageInfo` for `tabId`, and keep the visible chat pointed at the
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
 * killed MV3 worker, see `getToolsAndAvailabilityForTab`). Gating the swap
 * behind it meant a wedged worker could block the transcript from ever
 * restoring; now a wedged worker only costs the tool count and the context
 * chip. `setPageInfo`/`setTools` stay after the tools lookup, since they
 * need its result.
 *
 * `isStillActive` guards against a stale result clobbering a newer one: this
 * function `await`s three times now (`chrome.tabs.get`, the swap, then the
 * tools lookup) before touching the shared state each one owns, so a rapid
 * A → B → A tab switch can leave two overlapping calls in flight with no
 * ordering guarantee. Callers report whether `tabId` is still the active
 * tab; the check is re-run after each `await` and the call bails out the
 * moment it goes stale (card 54) — see also `initActiveTabSync`'s call-site
 * serialization, which additionally prevents an `onActivated` and an
 * `onUpdated` for the SAME tab from interleaving in the first place
 * (decisions/25 §2), something an identity check alone cannot do.
 */
async function refreshActiveTab(
  tabId: number,
  opts: { isNewTab: boolean },
  isStillActive: () => boolean,
): Promise<void> {
  trace("refreshActiveTab enter", { tabId, isNewTab: opts.isNewTab });
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
  // Sourced from `chat.activeTabOrigin()` (the tab's REAL current origin, set
  // only by a prior swap), never `panel.pageInfo?.origin` — `pageInfo` is
  // display state written AFTER a swap already applied, so it lags by one
  // microtask. An `onUpdated` racing an in-flight `onActivated` for the same
  // tab could otherwise read a not-yet-updated `pageInfo.origin`, wrongly
  // conclude the tab navigated, and fabricate a spurious empty chat
  // (decisions/25 §2).
  const previousOrigin = opts.isNewTab ? undefined : chat.activeTabOrigin();

  if (opts.isNewTab) {
    await chat.syncToTab(tabId, origin);
  } else if (previousOrigin !== origin) {
    await chat.applyNavigation(tabId, origin);
  }
  if (!isStillActive()) {
    trace("refreshActiveTab exit", { tabId, reason: "stale-before-apply" });
    return;
  }

  const { tools, available, restricted } = await getToolsAndAvailabilityForTab(tabId);
  if (!isStillActive()) {
    trace("refreshActiveTab exit", { tabId, reason: "stale-before-apply" });
    return;
  }

  setPageInfo({
    tabId,
    title: tab.title ?? "",
    origin,
    favIconUrl: tab.favIconUrl,
    toolCount: tools.length,
    restricted,
    webmcpAvailable: available,
  });
  // card 11's Tools view needs the full descriptors, not just the count.
  setTools(tabId, tools);
  trace("refreshActiveTab applied", { tabId, toolCount: tools.length });
}

/**
 * Serializes every `refreshActiveTab` call through one module-level promise
 * chain (decisions/25 §2, card 57) — the exact `indexQueue`/`withIndexLock`
 * shape already used by the chat store's index queue
 * (src/infra/chrome-storage/chat-store.ts's `withIndexLock`), reused rather
 * than reinvented. `isStillActive` (card 54) is an identity check: it can tell a
 * stale call "you're no longer for the active tab", but it structurally
 * cannot separate an `onActivated` and an `onUpdated` that both target the
 * SAME (still-active) tab and happen to overlap — both would pass the
 * identity check, and whichever's `await`s interleave last would win
 * nondeterministically. Running every call through this queue instead of
 * loosely with `void` gives them a total order matching the order the
 * browser actually fired the events in, one full `refreshActiveTab` at a
 * time. NOT reentrant, same caveat as `withIndexLock` — nothing here calls
 * back into `withRefreshLock` from inside `fn`, so that doesn't arise.
 */
let refreshQueue: Promise<void> = Promise.resolve();

function withRefreshLock(fn: () => Promise<void>): Promise<void> {
  const run = refreshQueue.then(fn, fn);
  refreshQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Wires `chrome.tabs`/`chrome.runtime` listeners that keep the panel's
 * `pageInfo` (and, on a tab switch or cross-origin navigation, the
 * transcript) in sync with the active tab. Call once from the app root;
 * returns a cleanup function that removes all listeners.
 *
 * Note: these listeners aren't scoped to a `windowId`, so a tab activation
 * in an unrelated browser window could in theory also reach `activeTabId`
 * here in a multi-window setup. Rarer than the single-window rapid-switch
 * race `isStillActive` fixes (card 54) — not addressed here.
 */
export function initActiveTabSync(): () => void {
  let activeTabId: number | undefined;

  void withRefreshLock(async () => {
    const tab = await getActiveTab();
    if (tab?.id === undefined) return;
    activeTabId = tab.id;
    await refreshActiveTab(tab.id, { isNewTab: true }, () => activeTabId === tab.id);
  });

  const onActivated = (info: chrome.tabs.OnActivatedInfo) => {
    trace("onActivated", { tabId: info.tabId });
    activeTabId = info.tabId;
    void withRefreshLock(() =>
      refreshActiveTab(info.tabId, { isNewTab: true }, () => activeTabId === info.tabId),
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
      void withRefreshLock(() =>
        refreshActiveTab(tabId, { isNewTab: false }, () => activeTabId === tabId),
      );
      return;
    }
    // A favicon can arrive after the title (or replace it later), and both
    // land here as a bare update with no URL change.
    if (
      (changeInfo.title !== undefined || changeInfo.favIconUrl !== undefined) &&
      panel.pageInfo
    ) {
      setPageInfo({
        ...panel.pageInfo,
        title: tab.title ?? "",
        favIconUrl: tab.favIconUrl,
      });
    }
  };

  // Live tool-count updates pushed by the worker as pages register/deregister
  // tools, without waiting for the panel to re-poll (src/background/sw.ts's
  // `runtime:tools-updated` broadcast).
  const onMessage = (message: unknown) => {
    if (!isRuntimeMessage(message) || message.type !== "runtime:tools-updated") return;
    if (message.tabId !== activeTabId) return;
    setToolCount(message.tabId, message.tools.length, message.available);
    setTools(message.tabId, message.tools);
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

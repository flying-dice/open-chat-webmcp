// Keeps the panel store's `pageInfo` in sync with whichever tab is active,
// and reacts to that tab navigating (decisions/01, decisions/02: tools and
// page identity are per-tab). This is the only file in the side panel that
// talks `chrome.tabs`/`chrome.runtime` directly — components read the
// result off src/sidepanel/stores/panel.svelte.ts instead.
//
// Tool counts (and, for card 11's inspector, the full descriptors — name,
// description, annotations, inputSchema) come from the background
// service worker's registry (src/background/sw.ts) via the shared
// request/response pair in src/lib/protocol.ts (`runtime:get-tools` /
// `runtime:get-tools-response`), never by talking to a tab's content script
// directly. `setPageInfo`/`setTools` on initial fetch and `setToolCount`/
// `setTools` on the worker's live `runtime:tools-updated` broadcast keep
// both in step with the same source.

import type { RuntimeGetToolsResponse, SerializedTool } from "../../lib/protocol";
import { isRuntimeMessage } from "../../lib/protocol";
import {
  applyPanelNavigation,
  panel,
  setPageInfo,
  setToolCount,
  setTools,
  syncSessionToTab,
} from "../stores/panel.svelte";

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

/** Exported for src/sidepanel/services/agentLoop.ts, which needs the same tab-tools lookup to attach page tools to a provider call. */
export async function getToolsForTab(tabId: number): Promise<SerializedTool[]> {
  return (await getToolsAndAvailabilityForTab(tabId)).tools;
}

/**
 * Same lookup as {@link getToolsForTab}, but also reports the worker's
 * `available`/`restricted` signals (see RuntimeGetToolsResponse.restricted's
 * doc comment in src/lib/protocol.ts, card 31) — `refreshActiveTab` below
 * needs all three to fill in `PageInfo.webmcpAvailable`/`restricted`
 * distinctly from an ordinary zero-tool page.
 */
async function getToolsAndAvailabilityForTab(
  tabId: number,
): Promise<{ tools: SerializedTool[]; available: boolean; restricted: boolean }> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "runtime:get-tools",
      tabId,
    })) as RuntimeGetToolsResponse | undefined;
    // Worker not reachable yet, or answered with an unexpected shape — default
    // `available: true, restricted: false` so a transient startup gap doesn't
    // flash "WebMCP unavailable"/"restricted page" for an ordinary page (see
    // PageInfo.webmcpAvailable's doc comment).
    return {
      tools: response?.tools ?? [],
      available: response?.available ?? true,
      restricted: response?.restricted ?? false,
    };
  } catch {
    // No listener yet (worker still starting) — treat as "no tools known".
    return { tools: [], available: true, restricted: false };
  }
}

/**
 * Refresh `pageInfo` for `tabId`, and keep the panel's session (card 12,
 * src/lib/session.ts) pointed at the right history (decision 07):
 *   - a real tab switch (`isNewTab`) loads-or-creates *that tab's own*
 *     persisted session — it may already have history, and switching tabs
 *     must swap to it rather than resetting ("switching tabs swaps the
 *     visible session; it never merges histories").
 *   - a same-tab cross-origin navigation resets the session (the old
 *     conversation refers to tools/page state that no longer exist);
 *     same-origin is a no-op.
 */
async function refreshActiveTab(tabId: number, opts: { isNewTab: boolean }): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab || tab.id !== tabId) return;

  const origin = originOf(tab.url);
  const previousOrigin = opts.isNewTab ? undefined : panel.pageInfo?.origin;
  const { tools, available, restricted } = await getToolsAndAvailabilityForTab(tabId);

  if (opts.isNewTab) {
    await syncSessionToTab(tabId, origin);
  } else if (previousOrigin !== origin) {
    await applyPanelNavigation(origin);
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
}

/**
 * Wires `chrome.tabs`/`chrome.runtime` listeners that keep the panel's
 * `pageInfo` (and, on a tab switch or cross-origin navigation, the
 * transcript) in sync with the active tab. Call once from the app root;
 * returns a cleanup function that removes all listeners.
 */
export function initActiveTabSync(): () => void {
  let activeTabId: number | undefined;

  void (async () => {
    const tab = await getActiveTab();
    if (tab?.id === undefined) return;
    activeTabId = tab.id;
    await refreshActiveTab(tab.id, { isNewTab: true });
  })();

  const onActivated = (info: chrome.tabs.OnActivatedInfo) => {
    activeTabId = info.tabId;
    void refreshActiveTab(info.tabId, { isNewTab: true });
  };

  const onUpdated = (
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab,
  ) => {
    if (tabId !== activeTabId) return;

    // Same gate the worker's own registry uses: only a real URL change
    // means "tools may now be stale" (decisions/02). A bare title update
    // (SPA setting document.title) does not warrant a transcript reset —
    // just refresh the displayed title in place.
    if (changeInfo.url !== undefined) {
      void refreshActiveTab(tabId, { isNewTab: false });
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

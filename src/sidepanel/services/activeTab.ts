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

/**
 * Best-effort match for a tab Chrome never lets a content script run in —
 * card 14 (boards/project-backlog/14-connection-diagnostics-and-empty-states.md).
 *
 * This is a CLIENT-SIDE heuristic on the tab's own URL, not a live check.
 * src/background/sw.ts already has a more authoritative version of this
 * same reasoning (`describeUnreachable`'s `"no-relay"` case, sw.ts:162-177)
 * — but it only ever fires as the *result of an attempted tool call*;
 * `handleGetTools` (sw.ts:273-296) reports a restricted tab the same way
 * as an ordinary page that simply has zero tools (an empty list, no
 * reason attached), by its own doc comment's admission. Since editing
 * src/background/** is out of this card's scope, and probing with a fake
 * tool call just to learn "why" would be worse (a spurious call logged
 * for every ordinary zero-tool page, which is most of the web), this
 * reproduces sw.ts's own enumeration from the tab's URL instead, so the
 * panel can explain the restriction up front rather than only after a
 * user tries to use it and something goes quietly nowhere.
 *
 * Chrome/Web-Store/chrome-extension cases are exact (scheme/host alone is
 * definitive). The PDF case is inherently a guess from a URL alone — see
 * the report for that gap.
 */
export function restrictedPageReason(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  const suffix = "— chat still works here, just without page tools.";

  if (
    parsed.protocol === "chrome:" ||
    parsed.protocol === "edge:" ||
    parsed.protocol === "about:" ||
    parsed.protocol === "devtools:"
  ) {
    return `This is a Chrome system page, which extensions can't run scripts on ${suffix}`;
  }
  if (parsed.protocol === "chrome-extension:") {
    return `This is another extension's page, which extensions can't run scripts on ${suffix}`;
  }
  if (
    parsed.hostname === "chromewebstore.google.com" ||
    (parsed.hostname === "chrome.google.com" && parsed.pathname.startsWith("/webstore"))
  ) {
    return `The Chrome Web Store blocks extension scripts on its own pages ${suffix}`;
  }
  if (parsed.pathname.toLowerCase().endsWith(".pdf")) {
    // Best-effort only: a `.pdf` URL usually opens in Chrome's built-in PDF
    // viewer, which blocks content scripts the same way — but a server can
    // technically serve a `.pdf` path as something else entirely, so this
    // can be wrong in either direction and there's no way to confirm it
    // from the URL alone.
    return `This looks like Chrome's built-in PDF viewer, which blocks extension scripts ${suffix}`;
  }
  return undefined;
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
 * Same lookup as {@link getToolsForTab}, but also reports whether
 * `document.modelContext` exists on the tab at all (decisions/16, card 43) —
 * `refreshActiveTab` below needs both to fill in `PageInfo.webmcpAvailable`
 * distinctly from an ordinary zero-tool page.
 */
async function getToolsAndAvailabilityForTab(
  tabId: number,
): Promise<{ tools: SerializedTool[]; available: boolean }> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "runtime:get-tools",
      tabId,
    })) as RuntimeGetToolsResponse | undefined;
    // Worker not reachable yet, or answered with an unexpected shape — default
    // `available: true` so a transient startup gap doesn't flash "WebMCP
    // unavailable" for an ordinary page (see PageInfo.webmcpAvailable's doc
    // comment).
    return { tools: response?.tools ?? [], available: response?.available ?? true };
  } catch {
    // No listener yet (worker still starting) — treat as "no tools known".
    return { tools: [], available: true };
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
  const { tools, available } = await getToolsAndAvailabilityForTab(tabId);

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
    restrictedReason: restrictedPageReason(tab.url),
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

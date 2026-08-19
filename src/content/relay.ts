// ISOLATED-world relay (decisions/02-mainworld-webmcp-bridge.md).
//
// Runs in the extension's ISOLATED world, injected at document_start on the
// same pages as src/inject/bridge.ts (MAIN world). This is the only script
// that can see both the page bridge (via CustomEvents on `document`) and
// `chrome.runtime` — it forwards tool announcements up to the service
// worker, and dispatches call requests from the worker down into the page,
// matching responses by id.
//
// Everything that crosses the world boundary is a JSON string on a
// CustomEvent (BRIDGE_OUT_EVENT / BRIDGE_IN_EVENT); everything that crosses
// to the service worker is a typed message from src/lib/protocol.ts.

import {
  BRIDGE_IN_EVENT,
  BRIDGE_OUT_EVENT,
  isBridgeOutEvent,
  isRuntimeMessage,
  type BridgeCallResultEvent,
  type BridgeInEvent,
  type RuntimeMessage,
  type RuntimeToolsUpdatedMessage,
  type SerializedTool,
} from "../lib/protocol";

// Round-trip budget for a worker-initiated tool call — the MIDDLE layer of a
// deliberate 3-layer timeout ladder (call chain: worker -> relay -> bridge):
//
//   src/inject/bridge.ts  EXECUTE_TIMEOUT_MS    = 20_000  (innermost)
//   src/content/relay.ts  RELAY_CALL_TIMEOUT_MS = 25_000  (this constant)
//   src/background/sw.ts  CALL_TIMEOUT_MS       = 30_000  (outermost)
//
// Deliberately longer than the bridge's own EXECUTE_TIMEOUT_MS
// (src/inject/bridge.ts) so that, in the common case, the bridge's own
// timeout error is what actually surfaces — this timeout is a backstop for
// when the bridge never answers at all (e.g. it failed to install, or the
// page tore down mid-call). If you change this value, keep it comfortably
// above the bridge's and comfortably below the worker's, or you re-break the
// ladder card 26 fixed.
const RELAY_CALL_TIMEOUT_MS = 25_000;

// Budget for answering a worker's `runtime:refresh-tools` request when we
// haven't observed a tool list from the bridge yet in this page lifetime.
// Kept comfortably under the worker's own ~3s give-up budget.
const REFRESH_TIMEOUT_MS = 2_500;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// ---------------------------------------------------------------------------
// Outgoing to the page bridge (relay -> bridge)
// ---------------------------------------------------------------------------

function dispatchToBridge(event: BridgeInEvent): void {
  let detail: string;
  try {
    detail = JSON.stringify(event);
  } catch (err) {
    console.error("[webmcp][relay] failed to serialise outgoing bridge event; dropping", event, err);
    return;
  }
  document.dispatchEvent(new CustomEvent(BRIDGE_IN_EVENT, { detail }));
}

// ---------------------------------------------------------------------------
// Outgoing to the service worker (relay -> worker)
// ---------------------------------------------------------------------------

function buildToolsUpdatedMessage(tools: SerializedTool[]): RuntimeToolsUpdatedMessage {
  return {
    type: "runtime:tools-updated",
    // A content script cannot learn its own tab id from any chrome.* API —
    // that's simply not exposed here. The worker MUST read `sender.tab.id`
    // off the chrome.runtime.onMessage callback for this message (which
    // Chrome always populates correctly for a message from a content
    // script) rather than trusting this field's value.
    tabId: -1,
    origin: location.origin,
    tools,
  };
}

function sendRuntimeMessage(msg: RuntimeMessage): void {
  try {
    chrome.runtime.sendMessage(msg).catch((err: unknown) => {
      console.debug(
        "[webmcp][relay] runtime message not delivered (worker may be asleep or not listening yet)",
        msg.type,
        err,
      );
    });
  } catch (err) {
    console.debug("[webmcp][relay] failed to send runtime message", msg.type, err);
  }
}

function safeRespond(sendResponse: (response: RuntimeMessage) => void, response: RuntimeMessage): void {
  try {
    sendResponse(response);
  } catch (err) {
    console.debug("[webmcp][relay] sendResponse failed (message channel likely closed)", err);
  }
}

// ---------------------------------------------------------------------------
// Tool list cache — lets us answer a worker's refresh request without
// necessarily waiting on a fresh round trip to the bridge, and lets us
// resolve pending refresh requests as soon as the bridge's first
// announcement lands.
// ---------------------------------------------------------------------------

let latestTools: SerializedTool[] = [];
let latestToolsKnown = false;

interface PendingRefresh {
  sendResponse: (response: RuntimeMessage) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingRefreshes: PendingRefresh[] = [];

function flushPendingRefreshes(): void {
  while (pendingRefreshes.length > 0) {
    const entry = pendingRefreshes.shift();
    if (!entry) continue;
    clearTimeout(entry.timer);
    safeRespond(entry.sendResponse, buildToolsUpdatedMessage(latestTools));
  }
}

function handleRefreshToolsRequest(sendResponse: (response: RuntimeMessage) => void): void {
  // Always nudge the bridge for a fresh announcement — cheap, and covers the
  // (unlikely) case where our cache is stale relative to the page.
  dispatchToBridge({ type: "bridge:get-tools" });

  if (latestToolsKnown) {
    safeRespond(sendResponse, buildToolsUpdatedMessage(latestTools));
    return;
  }

  // We haven't heard from the bridge at all yet in this page lifetime
  // (e.g. the relay only just started). Give it a short window to answer
  // before falling back to an empty list — the worker times out at ~3s
  // regardless, so there's no point waiting longer than that.
  const timer = setTimeout(() => {
    const idx = pendingRefreshes.findIndex((e) => e.sendResponse === sendResponse);
    if (idx !== -1) pendingRefreshes.splice(idx, 1);
    safeRespond(sendResponse, buildToolsUpdatedMessage(latestTools));
  }, REFRESH_TIMEOUT_MS);
  pendingRefreshes.push({ sendResponse, timer });
}

// ---------------------------------------------------------------------------
// Pending worker-initiated tool calls, matched by id.
// ---------------------------------------------------------------------------

interface PendingCall {
  sendResponse: (response: RuntimeMessage) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingCalls = new Map<string, PendingCall>();

function resolvePendingCall(result: BridgeCallResultEvent): void {
  const entry = pendingCalls.get(result.id);
  if (!entry) return; // unknown id, or already timed out
  clearTimeout(entry.timer);
  pendingCalls.delete(result.id);
  safeRespond(entry.sendResponse, {
    type: "runtime:call-tool-response",
    ok: result.ok,
    result: result.result,
    error: result.error,
  });
}

function cleanupPendingCalls(reason: string): void {
  for (const [id, entry] of pendingCalls) {
    clearTimeout(entry.timer);
    safeRespond(entry.sendResponse, { type: "runtime:call-tool-response", ok: false, error: reason });
    pendingCalls.delete(id);
  }
}

// ---------------------------------------------------------------------------
// chrome.runtime.onMessage: worker -> relay
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRuntimeMessage(message)) return false;

  if (message.type === "runtime:call-tool") {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingCalls.delete(id);
      safeRespond(sendResponse, {
        type: "runtime:call-tool-response",
        ok: false,
        error: `Timed out after ${RELAY_CALL_TIMEOUT_MS}ms waiting for a response from the page.`,
      });
    }, RELAY_CALL_TIMEOUT_MS);
    pendingCalls.set(id, { sendResponse, timer });

    const args = isRecord(message.args) ? message.args : {};
    dispatchToBridge({ type: "bridge:call-request", id, name: message.name, args });
    return true; // keep the channel open for the async response
  }

  if (message.type === "runtime:refresh-tools") {
    handleRefreshToolsRequest(sendResponse);
    return true;
  }

  // Not ours (e.g. runtime:get-tools is answered by the worker itself).
  return false;
});

// ---------------------------------------------------------------------------
// document events: bridge -> relay
// ---------------------------------------------------------------------------

document.addEventListener(BRIDGE_OUT_EVENT, (evt) => {
  const raw = (evt as CustomEvent<unknown>).detail;
  if (typeof raw !== "string") return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn("[webmcp][relay] ignoring malformed bridge:out payload", err);
    return;
  }
  if (!isBridgeOutEvent(parsed)) return;

  switch (parsed.type) {
    case "bridge:ready":
      console.debug("[webmcp][relay] bridge ready on", location.href);
      break;
    case "bridge:tools":
      latestTools = parsed.tools;
      latestToolsKnown = true;
      sendRuntimeMessage(buildToolsUpdatedMessage(parsed.tools));
      flushPendingRefreshes();
      break;
    case "bridge:call-result":
      resolvePendingCall(parsed);
      break;
    default: {
      const _exhaustive: never = parsed;
      void _exhaustive;
    }
  }
});

// ---------------------------------------------------------------------------
// Lifecycle: startup, unload, bfcache restore
// ---------------------------------------------------------------------------

// Handles the "panel opened late" case, and the case where the bridge
// (MAIN world) already announced before this listener was attached — ask
// for the current list unconditionally on startup. The bridge itself also
// announces unprompted on install, so between the two, ordering doesn't
// matter.
dispatchToBridge({ type: "bridge:get-tools" });

// A real navigation away — don't leave the worker (or panel) waiting on
// calls that will never resolve.
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return; // going into bfcache, not unloading
  cleanupPendingCalls("Page is unloading.");
});

// Coming back from bfcache: the page (and the MAIN-world bridge's state)
// survived, but the worker may have discarded anything it knew about this
// tab in the meantime. Re-announce so it catches up.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    dispatchToBridge({ type: "bridge:get-tools" });
  }
});

// Dev sanity check: confirm world isolation actually holds (bridge.ts
// stamps this on the page's real `window`; an ISOLATED-world content script
// has its own `window` layered over the same DOM and must not see it).
const leaked = (window as { __webmcpBridgeInstalled?: unknown }).__webmcpBridgeInstalled;
if (leaked !== undefined) {
  console.error(
    "[webmcp][relay] WORLD ISOLATION BROKEN: window.__webmcpBridgeInstalled leaked into the ISOLATED world:",
    leaked,
  );
}

export {};

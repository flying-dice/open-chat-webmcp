// Background service worker (module worker, MV3).
//
// Card: boards/project-backlog/04-background-tool-registry.md
// Deliberately small — per decisions/04-ollama-transport.md this worker
// NEVER talks to Ollama. Its only jobs are:
//   1. opening the side panel (decisions/01-side-panel-as-primary-ui.md)
//   2. holding the authoritative per-tab tool registry
//      (decisions/07-session-state-and-persistence.md), keyed by tab id with
//      the tab's origin stored alongside it
//   3. brokering `runtime:call-tool` between the panel and the tab's content
//      relay (src/content/relay.ts)
//
// MV3 service workers are killed and restarted at will (idle timeout,
// browser restart, extension update). Nothing here assumes the in-memory
// registry survives — every read path is able to rebuild its answer live
// from the relay when the cache is empty, and every listener is registered
// synchronously at module scope so Chrome can replay/deliver events to a
// freshly-woken worker.

import {
  isRuntimeMessage,
  type RuntimeCallToolRequest,
  type RuntimeCallToolResponse,
  type RuntimeGetToolsRequest,
  type RuntimeGetToolsResponse,
  type RuntimeRefreshToolsRequest,
  type RuntimeToolsUpdatedMessage,
  type SerializedTool,
} from "../infra/chrome-runtime";
import { SW_CALL_TIMEOUT_MS, SW_PULL_TIMEOUT_MS } from "../infra/webmcp";

console.log("[webmcp][sw] background service worker starting");

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[webmcp][sw] onInstalled", details.reason);
});

// Toolbar action opens the side panel directly, no popup
// (decisions/01-side-panel-as-primary-ui.md).
void chrome.sidePanel
  ?.setPanelBehavior?.({ openPanelOnActionClick: true })
  .catch((err) => console.error("[webmcp][sw] setPanelBehavior failed", err));

// ---------------------------------------------------------------------------
// Registry
//
// In-memory cache only. It is rebuilt from `runtime:tools-updated` pushes as
// they arrive, and — since the worker can restart at any moment and lose all
// of this — rebuilt live from the relay on demand when a lookup misses (see
// `pullToolsFromRelay` below).
// ---------------------------------------------------------------------------

interface RegistryEntry {
  origin: string;
  /**
   * Whether `document.modelContext` exists on this tab at all
   * (decisions/16-native-webmcp-client.md, card 43) — distinct from `tools`
   * being empty. `false` means WebMCP is off in this browser/for this
   * origin; `true` with `tools: []` means the feature is on and this page
   * simply hasn't registered anything.
   */
  available: boolean;
  tools: SerializedTool[];
}

const registry = new Map<number, RegistryEntry>();

function setRegistryEntry(tabId: number, entry: RegistryEntry): void {
  registry.set(tabId, entry);
}

function clearRegistryEntry(tabId: number, reason: string): void {
  if (registry.delete(tabId)) {
    console.log(`[webmcp][sw] cleared registry for tab ${tabId} (${reason})`);
  }
}

// Cleared on navigation. `changeInfo.url` is only present on the onUpdated
// event when the frame's URL actually changed — covers both full
// reloads/cross-origin navigation and same-document History API navigation,
// which is exactly "the page's tool set may no longer be valid".
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url !== undefined) {
    clearRegistryEntry(tabId, "navigation");
  }
});

// Cleared on tab close — also the mechanism that keeps a recycled tab id
// from inheriting a stale registry entry (decisions/07-session-state-and-persistence.md):
// the id is dropped here and only re-populated once a relay in the
// (possibly new) tab at that id announces itself again.
chrome.tabs.onRemoved.addListener((tabId) => {
  clearRegistryEntry(tabId, "tab removed");
});

// ---------------------------------------------------------------------------
// Talking to the relay in a specific tab
//
// `chrome.tabs.sendMessage` is how the worker reaches the content relay.
// There are two failure modes the card calls out explicitly:
//   - no relay in the tab at all (chrome://, Web Store, PDF viewer, etc.) —
//     the callback fires with `chrome.runtime.lastError` set, we must not
//     leave that unchecked or throw an unhandled rejection.
//   - the relay never responds — bounded with a timeout so callers never
//     hang.
// ---------------------------------------------------------------------------

type RelayReachResult =
  | { ok: true; response: unknown }
  | { ok: false; reason: "timeout" }
  | { ok: false; reason: "no-relay"; message: string }
  | { ok: false; reason: "error"; message: string };

function looksLikeNoRelay(message: string): boolean {
  return (
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection")
  );
}

function sendToRelay(tabId: number, msg: unknown, timeoutMs: number): Promise<RelayReachResult> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, reason: "timeout" });
    }, timeoutMs);

    try {
      chrome.tabs.sendMessage(tabId, msg, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        // MUST be read to avoid an "Unchecked runtime.lastError" warning —
        // this is exactly how a tab with no relay (chrome://, Web Store,
        // the PDF viewer) surfaces: no content script means no receiving
        // end, and that resolves as an error here, never a hang.
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          const message = lastError.message ?? "unknown messaging error";
          resolve(
            looksLikeNoRelay(message)
              ? { ok: false, reason: "no-relay", message }
              : { ok: false, reason: "error", message },
          );
          return;
        }

        resolve({ ok: true, response });
      });
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      resolve(
        looksLikeNoRelay(message)
          ? { ok: false, reason: "no-relay", message }
          : { ok: false, reason: "error", message },
      );
    }
  });
}

function describeUnreachable(tabId: number, result: RelayReachResult): string {
  if (result.ok) return "";
  switch (result.reason) {
    case "no-relay":
      return (
        `No WebMCP relay is available in tab ${tabId}. chrome://, ` +
        `chrome-extension://, the Chrome Web Store, and the built-in PDF ` +
        `viewer do not allow content scripts, so there is nothing to call ` +
        `there. (${result.message})`
      );
    case "timeout":
      return `Tab ${tabId} did not respond in time — the page may be busy or unresponsive.`;
    case "error":
      return `Could not reach tab ${tabId}: ${result.message}`;
  }
}

// Local pull request, worker -> relay only. Not part of the shared
// RuntimeRequest/RuntimeResponse pairs in src/infra/chrome-runtime/protocol.ts (those model
// panel <-> worker traffic) — this is an internal detail of how the worker
// rebuilds its cache and is not exported. The relay is expected to answer it
// the same way it announces tool changes on its own: with a
// `RuntimeToolsUpdatedMessage`, since that is the only existing message shape
// that carries the tab's origin alongside its tools, which the registry
// requires. See report for a flag on this assumption.

// TODO: clean-code - 0.3 - DRY: the inline `typeof v === "object" && v !== null && !Array.isArray` shape check here and in isCallToolResponse below is the same isRecord predicate reimplemented independently at least nine times across src/ (area.ts, json-rpc.ts, ollama/client.ts, openai/index.ts, relay.ts, SchemaProperty.svelte, ToolSchema.svelte, ToolArgValue.svelte).
function isToolsUpdatedMessage(v: unknown): v is RuntimeToolsUpdatedMessage {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>).type === "runtime:tools-updated" &&
    typeof (v as Record<string, unknown>).origin === "string" &&
    typeof (v as Record<string, unknown>).available === "boolean" &&
    Array.isArray((v as Record<string, unknown>).tools)
  );
}

function isCallToolResponse(v: unknown): v is RuntimeCallToolResponse {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>).type === "runtime:call-tool-response" &&
    typeof (v as Record<string, unknown>).ok === "boolean"
  );
}

// The worker's two rungs of the shared timeout ladder
// (src/infra/webmcp/timeouts.mjs, card 79 —
// boards/project-backlog/79-protocol-and-timeout-ladder-cleanup.md). Call
// chain for a real UI-driven tool call: side panel -> worker -> relay ->
// document.modelContext. The ladder lost its old MAIN-world-bridge rung in
// decisions/16-native-webmcp-client.md: the relay now executes tools
// directly against `document.modelContext` (`executeTool`) instead of
// round-tripping to a separate page-world script, so there is no fourth,
// page-side timeout to nest inside.
//
//   src/content/relay.ts                RELAY_EXECUTE_TIMEOUT_MS        = 20_000  (innermost)
//   src/background/sw.ts                SW_CALL_TIMEOUT_MS              = 30_000  (this rung)
//   src/domain/chat/turn.ts (injected)      AGENT_LOOP_TOOL_CALL_TIMEOUT_MS = 35_000  (outermost)
//
// Each layer must exceed the one it wraps with a comfortable margin so the
// innermost, most specific timeout error wins the race under real scheduling
// jitter instead of being masked by an outer layer's generic "did not
// respond in time". Previously (fixed by card 79) the side panel's own
// request-level timeout sat OUTSIDE this whole ladder and was *shorter* than
// this worker rung — the panel would give up and show its own generic
// timeout before the worker/relay could ever report the real outcome. The
// panel's timeout is now the ladder's outermost, largest rung instead, so
// this note describes the fixed ordering, not an open defect
// (see AGENT_LOOP_TOOL_CALL_TIMEOUT_MS's doc comment in timeouts.mjs).
//
// SW_PULL_TIMEOUT_MS below is a SEPARATE budget — the worker's own
// registry-rebuild GET to the relay (`runtime:refresh-tools`) after a cache
// miss, not part of this CALL ordering invariant.

/**
 * Rebuild-on-restart: ask the relay in `tabId` for its current tools right
 * now.
 *
 * On failure this also reports whether the failure was specifically
 * `sendToRelay`'s "no-relay" reason — the pattern-matched, authoritative
 * signal that there is no content script in this tab at all (card 31). A
 * timeout or other messaging error is NOT the same claim (the relay may well
 * exist and just be slow/busy), so only "no-relay" is reported as
 * `restricted: true`.
 */
async function pullToolsFromRelay(
  tabId: number,
): Promise<{ ok: true; entry: RegistryEntry } | { ok: false; restricted: boolean }> {
  const req: RuntimeRefreshToolsRequest = { type: "runtime:refresh-tools" };
  const result = await sendToRelay(tabId, req, SW_PULL_TIMEOUT_MS);
  if (!result.ok) {
    console.warn(
      `[webmcp][sw] could not rebuild registry for tab ${tabId}: ${describeUnreachable(tabId, result)}`,
    );
    return { ok: false, restricted: result.reason === "no-relay" };
  }
  if (!isToolsUpdatedMessage(result.response)) {
    console.warn(`[webmcp][sw] tab ${tabId} relay replied to refresh with an unexpected shape`);
    return { ok: false, restricted: false };
  }
  return {
    ok: true,
    entry: {
      origin: result.response.origin,
      available: result.response.available,
      tools: result.response.tools,
    },
  };
}

// ---------------------------------------------------------------------------
// Broadcasting to the panel
//
// The side panel may not be open — that must never throw or produce an
// unhandled rejection, just be a silent no-op.
// ---------------------------------------------------------------------------

function broadcastToolsUpdated(msg: RuntimeToolsUpdatedMessage): void {
  try {
    chrome.runtime.sendMessage(msg, () => {
      // No listener (panel closed) surfaces as lastError here — read it to
      // suppress the "Unchecked runtime.lastError" warning; there is
      // nothing else to do about it.
      void chrome.runtime.lastError;
    });
  } catch (err) {
    console.warn("[webmcp][sw] broadcast failed", err);
  }
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

async function handleGetTools(req: RuntimeGetToolsRequest): Promise<RuntimeGetToolsResponse> {
  const cached = registry.get(req.tabId);
  if (cached) {
    return {
      type: "runtime:get-tools-response",
      tabId: req.tabId,
      available: cached.available,
      restricted: false,
      tools: cached.tools,
    };
  }

  // Cache miss — either this tab never announced tools, or (far more likely
  // in practice) the worker was restarted and lost its in-memory state.
  // Rebuild live rather than reporting a false "no tools".
  const pulled = await pullToolsFromRelay(req.tabId);
  if (pulled.ok) {
    setRegistryEntry(req.tabId, pulled.entry);
    return {
      type: "runtime:get-tools-response",
      tabId: req.tabId,
      available: pulled.entry.available,
      restricted: false,
      tools: pulled.entry.tools,
    };
  }

  // No relay reachable at all (or it didn't answer in time) — e.g. a
  // chrome://, Web Store, or PDF-viewer tab with no content script. We have
  // no way to know whether WebMCP would even be available there, so this
  // reports `available: false` rather than claiming a definite "yes" or
  // "no" — the specific unreachable-reason is logged above and surfaces with
  // detail on the call-tool path, which does have an error field.
  // `restricted` carries the ADDITIONAL, authoritative claim that there is no
  // relay in this tab at all (card 31) — distinct from a merely slow/timed-out
  // one, which is not restricted, just unresponsive right now.
  return {
    type: "runtime:get-tools-response",
    tabId: req.tabId,
    available: false,
    restricted: pulled.restricted,
    tools: [],
  };
}

async function handleCallTool(req: RuntimeCallToolRequest): Promise<RuntimeCallToolResponse> {
  const result = await sendToRelay(req.tabId, req, SW_CALL_TIMEOUT_MS);

  if (!result.ok) {
    return {
      type: "runtime:call-tool-response",
      ok: false,
      error: describeUnreachable(req.tabId, result),
    };
  }

  if (!isCallToolResponse(result.response)) {
    return {
      type: "runtime:call-tool-response",
      ok: false,
      error: `Tab ${req.tabId} returned an unexpected response to the tool call.`,
    };
  }

  return result.response;
}

// ---------------------------------------------------------------------------
// Message router
//
// Registered synchronously at module scope so Chrome will deliver messages
// (and wake a suspended worker to do so) even right after a restart.
// Async handlers return `true` to keep the response channel open and settle
// it later via `sendResponse`; anything else returns false/undefined so the
// channel closes immediately.
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isRuntimeMessage(message)) return false;

  switch (message.type) {
    case "runtime:tools-updated": {
      // Relay -> Worker push. Require sender.tab.id (can't be spoofed by
      // page content, since this only reaches us from an ISOLATED-world
      // content script). The relay sends tabId: -1 as a sentinel since content
      // scripts cannot learn their own tab id; if sender.tab.id is absent,
      // the message is invalid and should be ignored.
      if (!sender.tab?.id) {
        console.warn("[webmcp][sw] runtime:tools-updated with missing sender.tab.id, ignoring");
        return false;
      }
      const tabId = sender.tab.id;
      setRegistryEntry(tabId, {
        origin: message.origin,
        available: message.available,
        tools: message.tools,
      });
      broadcastToolsUpdated({ ...message, tabId });
      return false;
    }

    case "runtime:get-tools": {
      handleGetTools(message).then(sendResponse);
      return true;
    }

    case "runtime:call-tool": {
      handleCallTool(message).then(sendResponse);
      return true;
    }

    default:
      // runtime:get-tools-response / runtime:call-tool-response are worker
      // -> panel only; the worker never receives them as inbound messages.
      return false;
  }
});

export {};

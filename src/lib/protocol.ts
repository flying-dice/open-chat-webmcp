// Shared message/type contracts used across all four extension contexts:
//
//   - MAIN-world bridge      (src/inject/bridge.ts)
//   - ISOLATED-world relay   (src/content/relay.ts)
//   - background service worker (src/background/sw.ts)
//   - side panel / options Svelte apps (src/sidepanel, src/options)
//
// This is the single source of truth for cross-context messages (see
// decisions/03-vite-svelte-build.md). Other cards build *on* this file —
// extend it as new message kinds are needed, but do not change the shape of
// an existing message without updating every consumer, and keep the `Msg`
// union exhaustive so a mismatch is a compile error rather than a silent
// no-op at runtime.

// ---------------------------------------------------------------------------
// Tool descriptors (decisions/02-mainworld-webmcp-bridge.md)
// ---------------------------------------------------------------------------

/** Where a tool descriptor originated from. */
export type ToolSource = "native" | "polyfill" | "shim";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  [key: string]: unknown;
}

/**
 * A WebMCP tool descriptor as serialized across a world/context boundary.
 * Payloads are JSON — never a live object/closure — because the bridge and
 * relay live in different JS worlds and only DOM events cross that boundary.
 */
export interface SerializedTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  source: ToolSource;
}

// ---------------------------------------------------------------------------
// Bridge (MAIN world) <-> Relay (ISOLATED world)
//
// These cross via `CustomEvent<string>` on `document`, detail is a JSON
// string (`JSON.stringify(...)`), never a live object:
//   BRIDGE_OUT_EVENT ("webmcp-bridge:out") — bridge -> relay
//   BRIDGE_IN_EVENT  ("webmcp-bridge:in")  — relay -> bridge
// ---------------------------------------------------------------------------

export const BRIDGE_OUT_EVENT = "webmcp-bridge:out";
export const BRIDGE_IN_EVENT = "webmcp-bridge:in";

/** Bridge -> Relay: the page's current tool list changed. */
export interface BridgeToolsEvent {
  type: "bridge:tools";
  tools: SerializedTool[];
}

/** Bridge -> Relay: the bridge has installed itself and is ready to receive calls. */
export interface BridgeReadyEvent {
  type: "bridge:ready";
}

/** Relay -> Bridge: ask the bridge to invoke a tool in the page world. */
export interface BridgeCallRequestEvent {
  type: "bridge:call-request";
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Relay -> Bridge: ask the bridge to resend its current tool list. Used on
 * relay startup (the bridge may have already announced before the relay's
 * listener was attached) and after a bfcache restore.
 */
export interface BridgeGetToolsRequestEvent {
  type: "bridge:get-tools";
}

/** Bridge -> Relay: result of a call the relay asked the bridge to make. */
export interface BridgeCallResultEvent {
  type: "bridge:call-result";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Events dispatched on {@link BRIDGE_OUT_EVENT} (bridge -> relay). */
export type BridgeOutEvent =
  | BridgeToolsEvent
  | BridgeReadyEvent
  | BridgeCallResultEvent;

/** Events dispatched on {@link BRIDGE_IN_EVENT} (relay -> bridge). */
export type BridgeInEvent = BridgeCallRequestEvent | BridgeGetToolsRequestEvent;

// ---------------------------------------------------------------------------
// Relay / side panel <-> background service worker (chrome.runtime messaging)
// ---------------------------------------------------------------------------

/** Relay -> Worker: this tab's tool list changed. */
export interface RuntimeToolsUpdatedMessage {
  type: "runtime:tools-updated";
  tabId: number;
  origin: string;
  tools: SerializedTool[];
}

/** Panel -> Worker: give me the current tool list for a tab. */
export interface RuntimeGetToolsRequest {
  type: "runtime:get-tools";
  tabId: number;
}

/** Worker -> Panel: response to {@link RuntimeGetToolsRequest}. */
export interface RuntimeGetToolsResponse {
  type: "runtime:get-tools-response";
  tabId: number;
  tools: SerializedTool[];
}

/** Panel -> Worker (-> Relay -> Bridge): invoke a tool in a given tab. */
export interface RuntimeCallToolRequest {
  type: "runtime:call-tool";
  tabId: number;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Worker -> Relay: the worker lost its in-memory per-tab tool registry (e.g.
 * the service worker was killed and restarted) and needs this tab's current
 * tool list resent immediately, rather than waiting for the next incidental
 * change. Sent via `chrome.tabs.sendMessage(tabId, ...)`; the relay answers
 * on the same channel with a {@link RuntimeToolsUpdatedMessage}. The worker
 * applies its own ~3s budget and falls back to an empty tool list if the
 * relay doesn't answer in time.
 *
 * NOTE: `src/background/sw.ts` currently defines an equivalent type locally
 * (`WorkerRefreshToolsRequest`) — it should switch to importing this shared
 * one instead of keeping its own copy.
 */
export interface RuntimeRefreshToolsRequest {
  type: "runtime:refresh-tools";
}

/** Worker -> Panel: response to {@link RuntimeCallToolRequest}. */
export interface RuntimeCallToolResponse {
  type: "runtime:call-tool-response";
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** One-way notifications sent over `chrome.runtime.sendMessage` / `onMessage`. */
export type RuntimeNotification = RuntimeToolsUpdatedMessage;

/** Request/response pairs sent over `chrome.runtime.sendMessage` (or long-lived ports). */
export type RuntimeRequest =
  | RuntimeGetToolsRequest
  | RuntimeCallToolRequest
  | RuntimeRefreshToolsRequest;
export type RuntimeResponse =
  | RuntimeGetToolsResponse
  | RuntimeCallToolResponse;

export type RuntimeMessage =
  | RuntimeNotification
  | RuntimeRequest
  | RuntimeResponse;

// ---------------------------------------------------------------------------
// Every message shape in the system, discriminated on `type`.
// Extend this union (and add a matching guard below) as new cards add
// message kinds — never invent an ad hoc message shape elsewhere.
// ---------------------------------------------------------------------------

export type Msg = BridgeOutEvent | BridgeInEvent | RuntimeMessage;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function isBridgeOutEvent(v: unknown): v is BridgeOutEvent {
  return (
    isRecord(v) &&
    (v.type === "bridge:tools" ||
      v.type === "bridge:ready" ||
      v.type === "bridge:call-result")
  );
}

export function isBridgeInEvent(v: unknown): v is BridgeInEvent {
  return (
    isRecord(v) &&
    (v.type === "bridge:call-request" || v.type === "bridge:get-tools")
  );
}

export function isRuntimeMessage(v: unknown): v is RuntimeMessage {
  return (
    isRecord(v) &&
    (v.type === "runtime:tools-updated" ||
      v.type === "runtime:get-tools" ||
      v.type === "runtime:get-tools-response" ||
      v.type === "runtime:call-tool" ||
      v.type === "runtime:call-tool-response" ||
      v.type === "runtime:refresh-tools")
  );
}

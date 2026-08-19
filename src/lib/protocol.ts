// Shared message/type contracts used across all three extension contexts:
//
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
//
// There used to be a fourth context, a MAIN-world bridge (src/inject/bridge.ts)
// that provided/adopted `navigator.modelContext`, and a CustomEvent transport
// (BRIDGE_OUT_EVENT/BRIDGE_IN_EVENT) connecting it to the relay. Both are gone
// as of decisions/16-native-webmcp-client.md: the relay now reads
// `document.modelContext` directly from the ISOLATED world, which decisions/16
// confirmed against real Chrome builds is enough on its own — no page-world
// script required.

// ---------------------------------------------------------------------------
// Tool descriptors (decisions/16-native-webmcp-client.md)
// ---------------------------------------------------------------------------

/**
 * The WebMCP `ToolAnnotations` dictionary has exactly these two members,
 * both defaulting to `false` — confirmed against Chrome 151/152's actual
 * `getTools()` output (decisions/16, decisions/17-spec-annotations-and-untrusted-content.md).
 * There is no `destructiveHint`: it is not in the IDL, and because
 * `ToolAnnotations` is a WebIDL dictionary, WebIDL conversion silently
 * discards any unknown member a page sets — so a page-set `destructiveHint`
 * never reaches us, it isn't merely unused. Do not re-add it.
 */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  /**
   * True when this tool's results may contain attacker-influenced content
   * (e.g. text authored by another user of the page) that gets fed straight
   * back into the model's context. Consumers must fence such results rather
   * than trusting them as instructions — see
   * src/sidepanel/services/agentLoop.ts's `fenceUntrustedContent` and
   * decisions/17. Like `readOnlyHint`, this is page-supplied and not a
   * security guarantee: a hostile page can omit it.
   */
  untrustedContentHint?: boolean;
  [key: string]: unknown;
}

/**
 * A WebMCP tool descriptor as reported to the rest of the extension.
 *
 * This is always plain JSON — never a live object/closure. The relay builds
 * it from the native `ModelContextToolInfo` Chrome hands back from
 * `document.modelContext.getTools()`, which additionally carries a live
 * `window` reference and a JSON-*string* `inputSchema`
 * (decisions/16-native-webmcp-client.md); the relay strips the former and
 * parses the latter before anything crosses to the service worker, since
 * `window` is not structured-cloneable.
 *
 * There is no `source` field any more (native/polyfill/shim) — decision 16
 * deleted the MAIN-world bridge that made that distinction meaningful. Every
 * tool reported from here on is native, or it isn't reported at all.
 */
export interface SerializedTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

// ---------------------------------------------------------------------------
// Relay / side panel <-> background service worker (chrome.runtime messaging)
// ---------------------------------------------------------------------------

/** Relay -> Worker: this tab's tool list changed. */
export interface RuntimeToolsUpdatedMessage {
  type: "runtime:tools-updated";
  tabId: number;
  origin: string;
  /**
   * Whether `document.modelContext` exists on this page at all
   * (decisions/16-native-webmcp-client.md). WebMCP is off by default in
   * Chrome — no `--enable-features=WebMCP`/flag/origin-trial token means
   * `document.modelContext` is `undefined`, not an empty implementation.
   * That is a DISTINCT state from "the browser supports WebMCP and this page
   * simply hasn't registered any tools" (`available: true`, `tools: []`),
   * and the panel must be able to tell the two apart (card 43) rather than
   * showing an identical empty tool list either way.
   */
  available: boolean;
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
  /** See {@link RuntimeToolsUpdatedMessage.available}. */
  available: boolean;
  tools: SerializedTool[];
}

/** Panel -> Worker (-> Relay): invoke a tool in a given tab. */
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

export type Msg = RuntimeMessage;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
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

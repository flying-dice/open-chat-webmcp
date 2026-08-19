// The remote MCP client (decisions/14-backend-mcp-servers.md): the
// initialize handshake, `tools/list`, and `tools/call` over MCP's two
// HTTP-based transports — modern Streamable HTTP and the deprecated
// HTTP+SSE transport kept for backwards compatibility — never stdio, never
// a helper process (a browser extension can't spawn one).
//
// Protocol version targeted: "2025-06-18" (the current spec at
// https://modelcontextprotocol.io/specification/2025-06-18/). Verified
// against the spec's lifecycle, transports, and tools pages directly rather
// than guessed:
//   - lifecycle: the `initialize` request/response/`notifications/initialized`
//     shapes and version-negotiation rule below (`SUPPORTED_PROTOCOL_VERSIONS`)
//     match /specification/2025-06-18/basic/lifecycle.
//   - transports: the Streamable HTTP request/response rules (POST with
//     `Accept: application/json, text/event-stream`, a JSON-or-SSE response,
//     `Mcp-Session-Id`, the legacy transport's GET->`endpoint` event->POST
//     dance for backwards compatibility) match
//     /specification/2025-06-18/basic/transports.
//   - tools: `tools/list` (with `cursor`/`nextCursor` pagination) and
//     `tools/call` (`content`/`structuredContent`/`isError`) match
//     /specification/2025-06-18/server/tools.
//
// Design: every exported function is a SELF-CONTAINED round trip — connect
// (initialize handshake), do exactly one thing (list tools / call one tool /
// just verify reachability), then close. There is no persistent connection
// object for a caller to hold, leak, or forget to close, which is the
// "hard to misuse" shape the card asked for at the cost of re-running the
// handshake on every call. For a browser-extension agent loop calling tools
// occasionally rather than a long-lived server-to-server client, that
// tradeoff favors correctness (no dangling session state, no reconnect
// logic) over saving one extra round trip. Session continuity (the MCP
// `Mcp-Session-Id` a server may hand back) is honored WITHIN one call's
// handshake+operation, never carried across calls.
//
// Never-throw discipline (mirrors src/lib/provider.ts, and this module's own
// src/lib/mcp/types.ts): every exported function returns an `McpResult`,
// never throws — including on a malformed/hostile server response.
//
// Per-server failure isolation (decisions/14: "must never stop the page's
// own tools from being offered"): every operation carries its own timeout
// budget (`Budget`, below) built from an internal `AbortController`, and
// `discoverAllServerTools` runs every enabled server concurrently via
// `Promise.all` over calls that themselves never reject — one dead or slow
// server resolves to a `status: "error"` entry within its own budget rather
// than rejecting the batch or blocking a faster server's result.
//
// This module intentionally does not import from src/lib/provider.ts,
// src/lib/protocol.ts, or src/lib/providers/**: those are owned by
// concurrent work on this repo. `McpResult`/`McpError` in ./types.ts are a
// deliberate parallel to `ProviderResult`/`ProviderError`, not a re-export.

import pkg from "../../../package.json" with { type: "json" };
import type { McpServerConfig } from "./registry";
import { CLIENT_CONTROLLED_HEADERS } from "./registry";
import type {
  McpConnectionInfo,
  McpError,
  McpResult,
  McpServerDiscovery,
  McpServerInfo,
  McpTool,
  McpToolContent,
  McpToolCallResult,
} from "./types";

// ---------------------------------------------------------------------------
// Protocol version
// ---------------------------------------------------------------------------

/** The protocol version this client requests in `initialize`, and always the first entry of {@link SUPPORTED_PROTOCOL_VERSIONS}. */
export const PROTOCOL_VERSION = "2025-06-18";

/**
 * Versions this client accepts when a server negotiates down (spec: "If the
 * server supports the requested protocol version, it MUST respond with the
 * same version. Otherwise, the server MUST respond with another protocol
 * version it supports... If the client does not support the version in the
 * server's response, it SHOULD disconnect"). `tools/list`/`tools/call`'s
 * wire shape is unchanged across all three, so accepting the two prior
 * versions costs nothing and covers servers that haven't upgraded yet.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

const CLIENT_NAME = pkg.name ?? "openchat-webmcp";
const CLIENT_VERSION = pkg.version ?? "0.0.0";

// ---------------------------------------------------------------------------
// Timeouts — a deliberate, separate budget from the extension's existing
// bridge(20s) < relay(25s) < worker(30s) < panel(35s) cross-context ladder
// (src/inject/bridge.ts, src/content/relay.ts, src/background/sw.ts,
// src/sidepanel/services/agentLoop.ts). That ladder times a same-machine
// message relay across JS worlds; this is a network round trip to a
// third-party server the extension doesn't control, so it gets its own
// numbers rather than being squeezed into that chain:
//
//   - Connect/list operations (handshake + a directory lookup) get a short
//     budget: a remote MCP server that can't complete an `initialize` and a
//     `tools/list` within 10s is unlikely to ever be pleasant to wait on,
//     and this runs once per server on every tool-list refresh — it should
//     fail fast so a dead server doesn't visibly stall the merged tool list.
//   - `tools/call` gets a longer budget, deliberately close to the existing
//     ladder's OUTERMOST (worker) rung of 30s: a remote tool invocation is
//     comparable in kind to a page tool call — the agent loop is waiting on
//     it the same way — so it should get comparable patience before this
//     module gives up, rather than an arbitrarily different number.
// ---------------------------------------------------------------------------

/** Budget for `testServerConnection`: initialize handshake only. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
/** Budget for a standalone `listServerTools` call: initialize + `tools/list` (with pagination). */
export const DEFAULT_LIST_TOOLS_TIMEOUT_MS = 10_000;
/** Per-server budget inside `discoverAllServerTools`: same handshake + list-tools work as {@link DEFAULT_LIST_TOOLS_TIMEOUT_MS}, given a couple extra seconds of headroom since it's competing for the event loop with every other server being discovered concurrently. */
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 12_000;
/** Budget for `callServerTool`: initialize + one `tools/call`. Deliberately close to src/background/sw.ts's `CALL_TIMEOUT_MS` (30_000) — see the module doc. */
export const DEFAULT_CALL_TOOL_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Small internal utilities
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function truncate(s: string, max = 500): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function safeReadText(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponseMsg {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

function isJsonRpcResponse(v: unknown): v is JsonRpcResponseMsg {
  return (
    isRecord(v) &&
    v.jsonrpc === "2.0" &&
    (Object.prototype.hasOwnProperty.call(v, "result") ||
      Object.prototype.hasOwnProperty.call(v, "error"))
  );
}

function tryParseJsonRpcError(body: string | undefined): JsonRpcErrorObject | undefined {
  if (!body) return undefined;
  try {
    const json: unknown = JSON.parse(body);
    if (
      isRecord(json) &&
      isRecord(json.error) &&
      typeof json.error.code === "number" &&
      typeof json.error.message === "string"
    ) {
      return { code: json.error.code, message: json.error.message, data: json.error.data };
    }
  } catch {
    // Not JSON — fall through, caller treats as a non-JSON-RPC body.
  }
  return undefined;
}

async function safeAuthMessage(response: Response): Promise<string> {
  const body = await safeReadText(response);
  const parsed = tryParseJsonRpcError(body);
  if (parsed) return parsed.message;
  return body ? truncate(body) : "Authentication failed.";
}

function classifyRpcError(err: JsonRpcErrorObject): McpError {
  // Spec's example initialization error is exactly this shape: code -32602
  // ("Invalid params"), message "Unsupported protocol version", data
  // `{ supported, requested }`. Recognize it specifically so a version
  // mismatch reported this way (rather than by a valid `initialize` result
  // naming a version this client doesn't accept) still lands as
  // `"protocol-mismatch"`, not a generic `"rpc-error"`.
  if (err.code === -32602 && /protocol version/i.test(err.message)) {
    const data = isRecord(err.data) ? err.data : undefined;
    const supported =
      data && Array.isArray(data.supported)
        ? data.supported.filter((s): s is string => typeof s === "string")
        : undefined;
    const requested = data && typeof data.requested === "string" ? data.requested : PROTOCOL_VERSION;
    return { kind: "protocol-mismatch", requested, supported, message: err.message };
  }
  return { kind: "rpc-error", code: err.code, message: err.message, data: err.data };
}

function toResultFromJsonRpc(msg: JsonRpcResponseMsg): McpResult<unknown> {
  if (msg.error) return { ok: false, error: classifyRpcError(msg.error) };
  return { ok: true, value: msg.result };
}

async function classifyHttpErrorResponse(response: Response): Promise<McpError> {
  const body = await safeReadText(response);
  const parsedRpcError = tryParseJsonRpcError(body);
  if (parsedRpcError) return classifyRpcError(parsedRpcError);
  return {
    kind: "not-mcp-endpoint",
    message: `Server responded ${response.status} ${response.statusText}${
      body ? `: ${truncate(body)}` : ""
    }.`,
  };
}

// ---------------------------------------------------------------------------
// Per-call timeout/abort budget
// ---------------------------------------------------------------------------

interface Budget {
  readonly signal: AbortSignal;
  timedOut(): boolean;
  classify(err: unknown): McpError;
  cleanup(): void;
}

/**
 * One timeout+abort budget for a whole exported call (connect, plus whatever
 * operation follows). Every `fetch` this module makes for that call is
 * signalled off `budget.signal`, so both an internal timeout and the
 * caller's own `AbortSignal` (if given) cancel every in-flight request at
 * once — this is what gives every server operation "its own timeout" per
 * the card, independent of every other server's.
 */
function createBudget(ms: number, externalSignal: AbortSignal | undefined): Budget {
  const controller = new AbortController();
  let didTimeOut = false;
  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
  }, ms);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort);
  }
  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    classify(err: unknown): McpError {
      if (err instanceof DOMException && err.name === "AbortError") {
        return didTimeOut
          ? { kind: "timeout", message: `Timed out after ${ms}ms waiting for the MCP server.` }
          : { kind: "aborted" };
      }
      // A blocked CORS preflight (host permission not granted) and a
      // genuinely unreachable host both reject `fetch` with a bare
      // TypeError — mirrors src/lib/providers/openai.ts's
      // `toOpenAiError`/src/lib/ollama.ts's `toOllamaError`: there is no way
      // to tell them apart from here, so the message names both.
      if (err instanceof TypeError) {
        return {
          kind: "unreachable",
          message:
            "Could not reach the configured MCP server. Either the host is down, or this extension hasn't been granted permission to talk to it yet — grant the host permission for this server and try again.",
        };
      }
      return {
        kind: "invalid-response",
        message: err instanceof Error ? err.message : String(err),
      };
    },
    cleanup() {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    },
  };
}

/** Reject `promise` early if `budget.signal` fires before it settles — used to bound waits (e.g. "the legacy transport's endpoint event") that aren't themselves a single `fetch` call. */
function raceWithBudget<T>(promise: Promise<T>, budget: Budget): Promise<T> {
  if (budget.signal.aborted) {
    return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    budget.signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        budget.signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        budget.signal.removeEventListener("abort", onAbort);
        reject(e as Error);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Headers (decisions/15-custom-headers-are-credentials.md)
// ---------------------------------------------------------------------------

/**
 * Custom headers from a server config, with any reserved name dropped —
 * defense-in-depth so a config that slipped past
 * `registry.ts`'s `validateServerHeaders` (e.g. one written before that
 * check existed, or by a foreign tool touching storage directly) still
 * can't override what the client controls for correctness. The visible
 * "refuse at edit time" UX decision 15 asks for is card 39's job; this is
 * the silent-drop safety net underneath it.
 */
function effectiveCustomHeaders(config: McpServerConfig): Record<string, string> {
  const headers = config.headers ?? {};
  const hasAuthToken = Boolean(config.auth?.token);
  const reserved = new Set<string>(CLIENT_CONTROLLED_HEADERS);
  if (hasAuthToken) reserved.add("authorization");
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (reserved.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}

function authHeader(config: McpServerConfig): Record<string, string> {
  return config.auth?.token ? { Authorization: `Bearer ${config.auth.token}` } : {};
}

/** Every header this server's requests carry except the transport-controlled `Content-Type`/`Accept`, which each call site sets itself (GET vs. POST need different values) and which always wins by being spread last. */
function buildBaseHeaders(config: McpServerConfig): Record<string, string> {
  return { ...effectiveCustomHeaders(config), ...authHeader(config) };
}

// ---------------------------------------------------------------------------
// SSE framing — chunk-boundary-safe like src/lib/providers/openai.ts's
// `extractSseEvents`, generalized to also capture the `event:` field (the
// legacy transport's `endpoint`/`message` events depend on it; OpenAI's
// parser can ignore it because OpenAI never sends one).
// ---------------------------------------------------------------------------

interface SseParseState {
  /** Bytes decoded but not yet consumed as a complete line. Persists across reads so a line split across a chunk boundary is assembled correctly. */
  buffer: string;
  /** `event:` value for the message currently being assembled; SSE defaults this to `"message"` and resets it after each dispatch. */
  currentEvent: string;
  /** `data:` line values collected for the message currently being assembled. */
  currentData: string[];
}

function freshSseState(): SseParseState {
  return { buffer: "", currentEvent: "message", currentData: [] };
}

/**
 * Split whatever's newly available in `state.buffer` into complete SSE
 * messages, in arrival order, leaving any trailing partial line (and any
 * not-yet-terminated message) buffered in `state` for the next call —
 * chunk-boundary-safe at both the line level (`state.buffer`) and the
 * message level (`state.currentEvent`/`state.currentData`), the same
 * two-level persistence src/lib/providers/openai.ts's `extractSseEvents`
 * uses. With `flush: true` (only at end of stream), also treats a trailing
 * unterminated line as complete and emits whatever's accumulated even
 * without a closing blank line.
 */
function extractSseMessages(
  state: SseParseState,
  opts?: { flush?: boolean },
): { event: string; data: string }[] {
  const messages: { event: string; data: string }[] = [];

  const consumeLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) {
      if (state.currentData.length > 0) {
        messages.push({ event: state.currentEvent, data: state.currentData.join("\n") });
      }
      state.currentData = [];
      state.currentEvent = "message";
      return;
    }
    if (line.startsWith(":")) return; // comment line
    if (line.startsWith("event:")) {
      const value = line.slice(6);
      state.currentEvent = value.startsWith(" ") ? value.slice(1) : value;
      return;
    }
    if (line.startsWith("data:")) {
      const value = line.slice(5);
      state.currentData.push(value.startsWith(" ") ? value.slice(1) : value);
      return;
    }
    // `id:`, `retry:`, or any other field — ignored. Resumability
    // (`Last-Event-ID` replay) is out of scope for this client: every call
    // is a fresh handshake (see the module doc), so there is never a
    // previous event id to resume from.
  };

  let newlineIndex: number;
  while ((newlineIndex = state.buffer.indexOf("\n")) >= 0) {
    const line = state.buffer.slice(0, newlineIndex);
    state.buffer = state.buffer.slice(newlineIndex + 1);
    consumeLine(line);
  }

  if (opts?.flush) {
    if (state.buffer.length > 0) {
      const trailing = state.buffer;
      state.buffer = "";
      consumeLine(trailing);
    }
    if (state.currentData.length > 0) {
      messages.push({ event: state.currentEvent, data: state.currentData.join("\n") });
      state.currentData = [];
      state.currentEvent = "message";
    }
  }

  return messages;
}

/** Read an SSE response body looking for the one JSON-RPC response matching `expectedId`, ignoring anything else on the stream (a server-initiated request/notification interleaved on the same stream — not needed since this client declares no server-callable capabilities). Bounded by `budget`: an abort (timeout or caller cancellation) rejects the in-flight `reader.read()`. */
async function readSseForResponse(
  body: ReadableStream<Uint8Array>,
  expectedId: number,
  budget: Budget,
): Promise<McpResult<JsonRpcResponseMsg>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state = freshSseState();
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        return { ok: false, error: budget.classify(err) };
      }
      if (chunk.done) break;
      state.buffer += decoder.decode(chunk.value, { stream: true });
      const found = scanForResponse(extractSseMessages(state), expectedId);
      if (found) return { ok: true, value: found };
    }
    state.buffer += decoder.decode();
    const found = scanForResponse(extractSseMessages(state, { flush: true }), expectedId);
    if (found) return { ok: true, value: found };
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        message: "SSE stream ended without a matching JSON-RPC response.",
      },
    };
  } finally {
    reader.releaseLock();
  }
}

function scanForResponse(
  events: { event: string; data: string }[],
  expectedId: number,
): JsonRpcResponseMsg | undefined {
  for (const evt of events) {
    if (evt.data.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(evt.data);
    } catch {
      continue; // malformed event on the wire — skip it, keep reading
    }
    if (isJsonRpcResponse(parsed) && parsed.id === expectedId) return parsed;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// initialize result validation (shared by both transports)
// ---------------------------------------------------------------------------

function normalizeServerInfo(raw: unknown): McpServerInfo | undefined {
  if (!isRecord(raw) || typeof raw.name !== "string") return undefined;
  return {
    name: raw.name,
    title: typeof raw.title === "string" ? raw.title : undefined,
    version: typeof raw.version === "string" ? raw.version : undefined,
  };
}

function validateInitializeResult(response: JsonRpcResponseMsg): McpResult<McpConnectionInfo> {
  if (response.error) return { ok: false, error: classifyRpcError(response.error) };

  const result = response.result;
  if (!isRecord(result) || typeof result.protocolVersion !== "string") {
    return {
      ok: false,
      error: { kind: "invalid-response", message: "initialize response was missing protocolVersion." },
    };
  }
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(result.protocolVersion)) {
    return {
      ok: false,
      error: {
        kind: "protocol-mismatch",
        requested: PROTOCOL_VERSION,
        supported: [...SUPPORTED_PROTOCOL_VERSIONS],
        message: `Server negotiated protocol version "${result.protocolVersion}", which this client does not support (supports ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}).`,
      },
    };
  }
  return {
    ok: true,
    value: {
      protocolVersion: result.protocolVersion,
      serverInfo: normalizeServerInfo(result.serverInfo),
      instructions: typeof result.instructions === "string" ? result.instructions : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// The live session — an abstraction over "send one more JSON-RPC request/
// notification to an already-initialized server", implemented once per
// transport. Never exported: callers only ever see the top-level functions
// at the bottom of this file, each of which builds one, uses it once, and
// closes it.
// ---------------------------------------------------------------------------

interface McpWireSession {
  readonly connection: McpConnectionInfo;
  request(method: string, params?: unknown): Promise<McpResult<unknown>>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): void;
}

function initializeParams(): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
  };
}

// --- Streamable HTTP (the modern transport; tried first unless the config
// pins "sse") --------------------------------------------------------------

function createStreamableHttpSession(
  url: string,
  postHeaders: Record<string, string>,
  sessionId: string | undefined,
  connection: McpConnectionInfo,
  budget: Budget,
): McpWireSession {
  let nextId = 2; // id 1 was the initialize request that produced `connection`.
  const headers = sessionId ? { ...postHeaders, "Mcp-Session-Id": sessionId } : postHeaders;

  async function post(msg: Record<string, unknown>): Promise<Response | { failed: McpError }> {
    try {
      return await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(msg),
        signal: budget.signal,
      });
    } catch (err) {
      return { failed: budget.classify(err) };
    }
  }

  return {
    connection,
    async request(method, params) {
      const id = nextId++;
      const response = await post({ jsonrpc: "2.0", id, method, params: params ?? {} });
      if ("failed" in response) return { ok: false, error: response.failed };

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          error: { kind: "auth", status: response.status, message: await safeAuthMessage(response) },
        };
      }
      if (!response.ok) {
        return { ok: false, error: await classifyHttpErrorResponse(response) };
      }

      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        let json: unknown;
        try {
          json = await response.json();
        } catch (err) {
          return {
            ok: false,
            error: { kind: "invalid-response", message: err instanceof Error ? err.message : String(err) },
          };
        }
        if (!isJsonRpcResponse(json)) {
          return { ok: false, error: { kind: "invalid-response", message: "Response body wasn't a JSON-RPC envelope." } };
        }
        return toResultFromJsonRpc(json);
      }
      if (contentType.includes("text/event-stream") && response.body) {
        const found = await readSseForResponse(response.body, id, budget);
        return found.ok ? toResultFromJsonRpc(found.value) : found;
      }
      return {
        ok: false,
        error: { kind: "invalid-response", message: `Unexpected content type "${contentType || "(none)"}".` },
      };
    },
    async notify(method, params) {
      // Best-effort: a failed "initialized" notification doesn't itself
      // invalidate an otherwise-successful handshake — a real connectivity
      // problem still surfaces on the very next `request()` call.
      await post({ jsonrpc: "2.0", method, params: params ?? {} });
    },
    close() {
      // No persistent resource to release for this transport — every
      // request is its own independent POST.
    },
  };
}

/** Attempt the Streamable HTTP handshake. `"try-legacy"` is only ever returned when `config.transport === "auto"` and the server answered with a 4xx that specifically signals "wrong transport" (404/405) — the spec's documented backwards-compatibility trigger — not on ordinary failures like an unreachable host or a 500. */
async function tryStreamableHttp(
  config: McpServerConfig,
  baseHeaders: Record<string, string>,
  budget: Budget,
): Promise<
  | { outcome: "connected"; session: McpWireSession }
  | { outcome: "failed"; error: McpError }
  | { outcome: "try-legacy" }
> {
  const headers = {
    ...baseHeaders,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const initMsg = { jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams() };

  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(initMsg),
      signal: budget.signal,
    });
  } catch (err) {
    return { outcome: "failed", error: budget.classify(err) };
  }

  const sessionId = response.headers.get("Mcp-Session-Id") ?? undefined;

  if (response.status === 401 || response.status === 403) {
    return {
      outcome: "failed",
      error: { kind: "auth", status: response.status, message: await safeAuthMessage(response) },
    };
  }
  if (config.transport === "auto" && (response.status === 404 || response.status === 405)) {
    return { outcome: "try-legacy" };
  }
  if (!response.ok) {
    return { outcome: "failed", error: await classifyHttpErrorResponse(response) };
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  let initResponse: JsonRpcResponseMsg;
  if (contentType.includes("application/json")) {
    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      return {
        outcome: "failed",
        error: {
          kind: "not-mcp-endpoint",
          message: `Response wasn't valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
    if (!isJsonRpcResponse(json)) {
      return {
        outcome: "failed",
        error: { kind: "not-mcp-endpoint", message: "Response body wasn't a JSON-RPC envelope." },
      };
    }
    initResponse = json;
  } else if (contentType.includes("text/event-stream")) {
    if (!response.body) {
      return { outcome: "failed", error: { kind: "not-mcp-endpoint", message: "SSE response had no body." } };
    }
    const found = await readSseForResponse(response.body, 1, budget);
    if (!found.ok) return { outcome: "failed", error: found.error };
    initResponse = found.value;
  } else {
    return {
      outcome: "failed",
      error: {
        kind: "not-mcp-endpoint",
        message: `Unexpected content type "${contentType || "(none)"}" from the MCP endpoint.`,
      },
    };
  }

  const parsedInit = validateInitializeResult(initResponse);
  if (!parsedInit.ok) return { outcome: "failed", error: parsedInit.error };

  const session = createStreamableHttpSession(config.url, headers, sessionId, parsedInit.value, budget);
  await session.notify("notifications/initialized");
  return { outcome: "connected", session };
}

// --- Legacy HTTP+SSE (protocol version 2024-11-05's transport, kept only
// for backwards compatibility per the spec) ---------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  readonly settled: boolean;
}

function createDeferred<T>(): Deferred<T> {
  let resolveFn!: (v: T) => void;
  let rejectFn!: (e: unknown) => void;
  let settled = false;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = (v) => {
      settled = true;
      resolve(v);
    };
    rejectFn = (e) => {
      settled = true;
      reject(e as Error);
    };
  });
  return {
    promise,
    resolve: resolveFn,
    reject: rejectFn,
    get settled() {
      return settled;
    },
  };
}

/**
 * Pumps one legacy-transport GET SSE stream in the background, resolving
 * the `endpoint` event once (so the caller learns where to POST) and
 * fulfilling per-request-id waiters as `message` events carrying a matching
 * JSON-RPC response arrive. One instance is created per call (see the
 * module doc: no cross-call session reuse), and `close()`d in every code
 * path once that call's single operation is done.
 */
class LegacySsePump {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly baseUrl: string;
  private readonly decoder = new TextDecoder();
  private readonly state = freshSseState();
  private readonly endpointDeferred = createDeferred<string>();
  private readonly waiters = new Map<number, (msg: JsonRpcResponseMsg) => void>();
  private stopped = false;

  constructor(response: Response, baseUrl: string) {
    // `tryStreamableHttp`/`connectLegacySse` already checked `response.body`
    // is present before constructing this.
    this.reader = response.body!.getReader();
    this.baseUrl = baseUrl;
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      while (!this.stopped) {
        const { done, value } = await this.reader.read();
        if (done) break;
        this.state.buffer += this.decoder.decode(value, { stream: true });
        this.handle(extractSseMessages(this.state));
      }
      this.state.buffer += this.decoder.decode();
      this.handle(extractSseMessages(this.state, { flush: true }));
    } catch {
      // Stream errored or was cancelled — outstanding waiters are left
      // unresolved deliberately; every waiter is raced against the same
      // call's `budget` via `raceWithBudget`, so nothing hangs past that
      // budget regardless of what happens to this pump.
    } finally {
      if (!this.endpointDeferred.settled) {
        this.endpointDeferred.reject(new Error("SSE stream ended before an endpoint event arrived."));
      }
    }
  }

  private handle(events: { event: string; data: string }[]): void {
    for (const evt of events) {
      if (evt.event === "endpoint") {
        if (!this.endpointDeferred.settled) {
          this.endpointDeferred.resolve(new URL(evt.data.trim(), this.baseUrl).toString());
        }
        continue;
      }
      if (evt.data.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(evt.data);
      } catch {
        continue;
      }
      if (!isJsonRpcResponse(parsed) || typeof parsed.id !== "number") continue;
      const waiter = this.waiters.get(parsed.id);
      if (waiter) {
        this.waiters.delete(parsed.id);
        waiter(parsed);
      }
    }
  }

  endpoint(): Promise<string> {
    return this.endpointDeferred.promise;
  }

  waitForResponse(id: number): Promise<JsonRpcResponseMsg> {
    return new Promise((resolve) => {
      this.waiters.set(id, resolve);
    });
  }

  close(): void {
    this.stopped = true;
    this.waiters.clear();
    try {
      void this.reader.cancel();
    } catch {
      // Already closed/errored — nothing left to release.
    }
  }
}

async function postLegacyMessage(
  endpoint: string,
  baseHeaders: Record<string, string>,
  msg: Record<string, unknown>,
  budget: Budget,
): Promise<McpResult<void>> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { ...baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(msg),
      signal: budget.signal,
    });
  } catch (err) {
    return { ok: false, error: budget.classify(err) };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: { kind: "auth", status: response.status, message: await safeAuthMessage(response) },
    };
  }
  // The spec mandates 202 for an accepted notification/response; be
  // lenient and accept any 2xx here too, since some legacy servers reply
  // 200 to the initial POST instead.
  if (response.ok) return { ok: true, value: undefined };
  return { ok: false, error: await classifyHttpErrorResponse(response) };
}

async function connectLegacySse(
  config: McpServerConfig,
  baseHeaders: Record<string, string>,
  budget: Budget,
): Promise<McpResult<McpWireSession>> {
  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "GET",
      headers: { ...baseHeaders, Accept: "text/event-stream" },
      signal: budget.signal,
    });
  } catch (err) {
    return { ok: false, error: budget.classify(err) };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: { kind: "auth", status: response.status, message: await safeAuthMessage(response) },
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: {
        kind: "not-mcp-endpoint",
        message: `Server responded ${response.status} to both the Streamable HTTP and legacy SSE handshake attempts — this doesn't look like an MCP endpoint.`,
      },
    };
  }
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    return {
      ok: false,
      error: { kind: "not-mcp-endpoint", message: "Server did not open an SSE stream for the legacy MCP transport either." },
    };
  }

  const pump = new LegacySsePump(response, config.url);

  let postEndpoint: string;
  try {
    postEndpoint = await raceWithBudget(pump.endpoint(), budget);
  } catch (err) {
    pump.close();
    return {
      ok: false,
      error: budget.timedOut()
        ? { kind: "timeout", message: 'Timed out waiting for the legacy SSE "endpoint" event.' }
        : { kind: "not-mcp-endpoint", message: err instanceof Error ? err.message : String(err) },
    };
  }

  let nextId = 2; // id 1 is used for initialize, below.
  const initMsg = { jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams() };
  const waitForInit = pump.waitForResponse(1);
  const posted = await postLegacyMessage(postEndpoint, baseHeaders, initMsg, budget);
  if (!posted.ok) {
    pump.close();
    return posted;
  }

  let initResponse: JsonRpcResponseMsg;
  try {
    initResponse = await raceWithBudget(waitForInit, budget);
  } catch {
    pump.close();
    return {
      ok: false,
      error: budget.timedOut()
        ? { kind: "timeout", message: "Timed out waiting for the initialize response." }
        : { kind: "invalid-response", message: "Legacy SSE stream closed before the initialize response arrived." },
    };
  }

  const parsedInit = validateInitializeResult(initResponse);
  if (!parsedInit.ok) {
    pump.close();
    return parsedInit;
  }

  const session: McpWireSession = {
    connection: parsedInit.value,
    async request(method, params) {
      const id = nextId++;
      const waiter = pump.waitForResponse(id);
      const sent = await postLegacyMessage(postEndpoint, baseHeaders, { jsonrpc: "2.0", id, method, params: params ?? {} }, budget);
      if (!sent.ok) return sent;
      try {
        const resp = await raceWithBudget(waiter, budget);
        return toResultFromJsonRpc(resp);
      } catch {
        return {
          ok: false,
          error: budget.timedOut()
            ? { kind: "timeout", message: `Timed out waiting for a response to "${method}".` }
            : { kind: "invalid-response", message: "Legacy SSE stream closed before a response arrived." },
        };
      }
    },
    async notify(method, params) {
      await postLegacyMessage(postEndpoint, baseHeaders, { jsonrpc: "2.0", method, params: params ?? {} }, budget);
    },
    close() {
      pump.close();
    },
  };

  await session.notify("notifications/initialized");
  return { ok: true, value: session };
}

// --- Transport selection -----------------------------------------------

async function connect(config: McpServerConfig, budget: Budget): Promise<McpResult<McpWireSession>> {
  const baseHeaders = buildBaseHeaders(config);

  if (config.transport !== "sse") {
    const attempt = await tryStreamableHttp(config, baseHeaders, budget);
    if (attempt.outcome === "connected") return { ok: true, value: attempt.session };
    if (attempt.outcome === "failed") return { ok: false, error: attempt.error };
    // outcome === "try-legacy": only reachable with transport === "auto".
  }

  if (config.transport === "streamable-http") {
    // tryStreamableHttp always returns "connected" or "failed" for a config
    // pinned to this transport — "try-legacy" is unreachable above in that
    // case — but keep a defensive fallback rather than falling through to
    // an unrelated transport attempt.
    return {
      ok: false,
      error: { kind: "not-mcp-endpoint", message: "Streamable HTTP handshake did not complete." },
    };
  }

  return connectLegacySse(config, baseHeaders, budget);
}

// ---------------------------------------------------------------------------
// tools/list, tools/call — result parsing (defensive: a malformed individual
// tool or content item is dropped/coerced rather than failing the whole
// call, the same posture src/lib/providers/openai.ts's `normalizeModel`
// takes toward a malformed model entry)
// ---------------------------------------------------------------------------

function normalizeTool(raw: unknown): McpTool | null {
  if (!isRecord(raw) || typeof raw.name !== "string" || raw.name.length === 0) return null;
  return {
    name: raw.name,
    title: typeof raw.title === "string" ? raw.title : undefined,
    description: typeof raw.description === "string" ? raw.description : undefined,
    inputSchema: isRecord(raw.inputSchema) ? raw.inputSchema : undefined,
    outputSchema: isRecord(raw.outputSchema) ? raw.outputSchema : undefined,
    annotations: isRecord(raw.annotations) ? raw.annotations : undefined,
  };
}

function parseToolsListResult(value: unknown): McpResult<{ tools: McpTool[]; nextCursor?: string }> {
  if (!isRecord(value) || !Array.isArray(value.tools)) {
    return { ok: false, error: { kind: "invalid-response", message: "tools/list result was missing a `tools` array." } };
  }
  const tools = value.tools.map(normalizeTool).filter((t): t is McpTool => t !== null);
  const nextCursor = typeof value.nextCursor === "string" ? value.nextCursor : undefined;
  return { ok: true, value: { tools, nextCursor } };
}

/** Coerce one tools/call `content` item into a known {@link McpToolContent} shape, falling back to a `text` item carrying the raw JSON for anything unrecognized (a future content type, or a malformed one) rather than dropping it — nothing the server returned silently disappears. */
function normalizeContent(raw: unknown): McpToolContent {
  const fallback = (): McpToolContent => ({ type: "text", text: JSON.stringify(raw) });
  if (!isRecord(raw) || typeof raw.type !== "string") return fallback();
  switch (raw.type) {
    case "text":
      return typeof raw.text === "string" ? { type: "text", text: raw.text } : fallback();
    case "image":
      return typeof raw.data === "string" && typeof raw.mimeType === "string"
        ? { type: "image", data: raw.data, mimeType: raw.mimeType }
        : fallback();
    case "audio":
      return typeof raw.data === "string" && typeof raw.mimeType === "string"
        ? { type: "audio", data: raw.data, mimeType: raw.mimeType }
        : fallback();
    case "resource_link":
      return typeof raw.uri === "string"
        ? {
            type: "resource_link",
            uri: raw.uri,
            name: typeof raw.name === "string" ? raw.name : undefined,
            description: typeof raw.description === "string" ? raw.description : undefined,
            mimeType: typeof raw.mimeType === "string" ? raw.mimeType : undefined,
          }
        : fallback();
    case "resource":
      return isRecord(raw.resource) && typeof raw.resource.uri === "string"
        ? {
            type: "resource",
            resource: {
              uri: raw.resource.uri,
              mimeType: typeof raw.resource.mimeType === "string" ? raw.resource.mimeType : undefined,
              text: typeof raw.resource.text === "string" ? raw.resource.text : undefined,
              blob: typeof raw.resource.blob === "string" ? raw.resource.blob : undefined,
            },
          }
        : fallback();
    default:
      return fallback();
  }
}

function parseToolCallResult(value: unknown): McpResult<McpToolCallResult> {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    return { ok: false, error: { kind: "invalid-response", message: "tools/call result was missing a `content` array." } };
  }
  return {
    ok: true,
    value: {
      content: value.content.map(normalizeContent),
      structuredContent: isRecord(value.structuredContent) ? value.structuredContent : undefined,
      isError: typeof value.isError === "boolean" ? value.isError : false,
    },
  };
}

/** Follows `nextCursor` per the spec's pagination convention, bounded defensively so a server that never terminates pagination can't loop forever within the caller's own timeout budget. */
async function listToolsViaSession(session: McpWireSession): Promise<McpResult<McpTool[]>> {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  let guard = 0;
  const MAX_PAGES = 50;
  do {
    const result = await session.request("tools/list", cursor ? { cursor } : {});
    if (!result.ok) return result;
    const parsed = parseToolsListResult(result.value);
    if (!parsed.ok) return parsed;
    tools.push(...parsed.value.tools);
    cursor = parsed.value.nextCursor;
    guard += 1;
  } while (cursor && guard < MAX_PAGES);
  return { ok: true, value: tools };
}

async function callToolViaSession(
  session: McpWireSession,
  toolName: string,
  args: Record<string, unknown> | undefined,
): Promise<McpResult<McpToolCallResult>> {
  const result = await session.request("tools/call", { name: toolName, arguments: args ?? {} });
  if (!result.ok) return result;
  return parseToolCallResult(result.value);
}

// ---------------------------------------------------------------------------
// Public API — cards 38 (agent-loop merge) and 39 (management UI) code
// against these four functions and nothing else in this module.
// ---------------------------------------------------------------------------

export interface McpCallOptions {
  signal?: AbortSignal;
  /** Override the default budget for this call — see the DEFAULT_*_TIMEOUT_MS constants above. */
  timeoutMs?: number;
}

/**
 * Verify a server config is reachable and speaks MCP, without listing or
 * calling anything — the connection-test action a management UI (card 39)
 * wants, and decisions/15's requirement that a connection test "send the
 * custom headers, so testing exercises the real request". Resolves the
 * server's negotiated protocol version and identity on success.
 */
export async function testServerConnection(
  config: McpServerConfig,
  opts?: McpCallOptions,
): Promise<McpResult<McpConnectionInfo>> {
  const budget = createBudget(opts?.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS, opts?.signal);
  try {
    const result = await connect(config, budget);
    if (!result.ok) return result;
    result.value.close();
    return { ok: true, value: result.value.connection };
  } finally {
    budget.cleanup();
  }
}

/** Connect and list every tool one server currently offers (paginating through `nextCursor` internally). */
export async function listServerTools(
  config: McpServerConfig,
  opts?: McpCallOptions,
): Promise<McpResult<McpTool[]>> {
  const budget = createBudget(opts?.timeoutMs ?? DEFAULT_LIST_TOOLS_TIMEOUT_MS, opts?.signal);
  try {
    const session = await connect(config, budget);
    if (!session.ok) return session;
    try {
      return await listToolsViaSession(session.value);
    } finally {
      session.value.close();
    }
  } finally {
    budget.cleanup();
  }
}

/** Connect and invoke one tool on one server. `isError: true` in a successful `McpResult` is the tool's OWN reported failure (spec's "Tool Execution Errors") — still `ok: true` here, since the protocol-level round trip succeeded; only a transport/protocol failure produces `ok: false`. */
export async function callServerTool(
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown> | undefined,
  opts?: McpCallOptions,
): Promise<McpResult<McpToolCallResult>> {
  const budget = createBudget(opts?.timeoutMs ?? DEFAULT_CALL_TOOL_TIMEOUT_MS, opts?.signal);
  try {
    const session = await connect(config, budget);
    if (!session.ok) return session;
    try {
      return await callToolViaSession(session.value, toolName, args);
    } finally {
      session.value.close();
    }
  } finally {
    budget.cleanup();
  }
}

async function discoverOneServer(
  config: McpServerConfig,
  opts: McpCallOptions | undefined,
): Promise<McpServerDiscovery> {
  const budget = createBudget(opts?.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS, opts?.signal);
  try {
    const session = await connect(config, budget);
    if (!session.ok) {
      return { status: "error", serverId: config.id, serverName: config.name, error: session.error };
    }
    try {
      const tools = await listToolsViaSession(session.value);
      if (!tools.ok) {
        return { status: "error", serverId: config.id, serverName: config.name, error: tools.error };
      }
      return {
        status: "ok",
        serverId: config.id,
        serverName: config.name,
        connection: session.value.connection,
        tools: tools.value,
      };
    } finally {
      session.value.close();
    }
  } catch (err) {
    // Belt-and-suspenders: this function must never throw and never let one
    // server's bug take down the whole batch (decisions/14) — everything
    // above already returns `McpResult`/never-throw shapes, but a defensive
    // catch here means a bug in this module itself still degrades to one
    // failed server entry instead of an unhandled rejection in
    // `discoverAllServerTools`'s `Promise.all`.
    return {
      status: "error",
      serverId: config.id,
      serverName: config.name,
      error: { kind: "invalid-response", message: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    budget.cleanup();
  }
}

/**
 * Discover tools across every ENABLED configured server, one entry per
 * server, concurrently. This is the per-server-failure-isolation guarantee
 * the card requires: `discoverOneServer` never rejects (every failure mode
 * becomes a `status: "error"` entry with a budget-bounded own timeout), so
 * `Promise.all` here never rejects either — one dead or slow server can
 * only ever affect its own entry, never the batch, and never take longer
 * than its own `timeoutMs` to resolve one way or the other. Card 38 is
 * responsible for merging the `status: "ok"` entries' tools into the
 * model's tool list (namespaced per decisions/14) and deciding what, if
 * anything, to surface about the `status: "error"` entries.
 */
export async function discoverAllServerTools(
  servers: McpServerConfig[],
  opts?: McpCallOptions,
): Promise<McpServerDiscovery[]> {
  return Promise.all(servers.map((server) => discoverOneServer(server, opts)));
}

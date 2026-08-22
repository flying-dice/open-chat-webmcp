// The MODERN transport: MCP's Streamable HTTP (card 76; moved unchanged from
// src/lib/mcp/client.ts).
//
// The request/response rules here — POST with
// `Accept: application/json, text/event-stream`, a JSON-or-SSE response,
// `Mcp-Session-Id` — match /specification/2025-06-18/basic/transports,
// verified against the spec directly rather than guessed.
//
// Session continuity (the `Mcp-Session-Id` a server may hand back) is honored
// WITHIN one call's handshake+operation and never carried across calls.

import type { McpError, McpServerConfig } from "../../domain/tools";
import type { Budget } from "./budget";
import {
  classifyHttpErrorResponse,
  isJsonRpcResponse,
  safeAuthMessage,
  toResultFromJsonRpc as toResult,
  type JsonRpcResponseMsg,
} from "./json-rpc";
import type { McpClientInfo } from "./protocol";
import { readSseForResponse } from "./sse";
import { initializeParams, validateInitializeResult, type McpWireSession } from "./session";

function createStreamableHttpSession(
  url: string,
  postHeaders: Record<string, string>,
  sessionId: string | undefined,
  connection: McpWireSession["connection"],
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

      // TODO: clean-code - 0.3 - DRY: this 401/403 -> {kind:"auth",...} block is repeated here and below, and twice more in legacy-sse.ts (four occurrences total) — a classifyAuthStatus(response) helper in json-rpc.ts (already imported by both files) would collapse all four.
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
        return toResult(json);
      }
      if (contentType.includes("text/event-stream") && response.body) {
        const found = await readSseForResponse(response.body, id, budget);
        return found.ok ? toResult(found.value) : found;
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
export async function tryStreamableHttp(
  config: McpServerConfig,
  baseHeaders: Record<string, string>,
  clientInfo: McpClientInfo,
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
  const initMsg = { jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams(clientInfo) };

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

  // TODO: clean-code - 0.3 - DRY: this 401/403 -> {kind:"auth",...} block is repeated here and above, and twice more in legacy-sse.ts (four occurrences total) — a classifyAuthStatus(response) helper in json-rpc.ts (already imported by both files) would collapse all four.
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

// JSON-RPC 2.0 envelopes on the wire, and the mapping from a server's
// failure into the domain's `McpError` vocabulary (card 76; moved unchanged
// from src/lib/mcp/client.ts).
//
// This is the file that keeps decisions/29's "nothing in src/domain ever
// sees an HTTP status or a fetch rejection" true for the MCP side: an HTTP
// status, a JSON-RPC `error` object and a malformed body all become an
// `McpError` here, and nothing above this layer looks at a `Response` again.

import type { McpError, McpResult } from "../../domain/tools";
import { PROTOCOL_VERSION } from "./protocol";

// TODO: clean-code - 0.3 - DRY: this isRecord predicate is reimplemented independently at least nine times across src/ (area.ts, ollama/client.ts, openai/index.ts, relay.ts, sw.ts, SchemaProperty.svelte, ToolSchema.svelte, ToolArgValue.svelte).
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function truncate(s: string, max = 500): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// TODO: clean-code - 0.35 - DRY: this safeReadText is independently redefined in src/infra/ollama/client.ts and src/infra/openai/index.ts; adapters-do-not-import-adapters blocks a shared infra util but nothing stops passing the body as an argument instead.
export async function safeReadText(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponseMsg {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

export function isJsonRpcResponse(v: unknown): v is JsonRpcResponseMsg {
  return (
    isRecord(v) &&
    v.jsonrpc === "2.0" &&
    (Object.prototype.hasOwnProperty.call(v, "result") ||
      Object.prototype.hasOwnProperty.call(v, "error"))
  );
}

export function tryParseJsonRpcError(body: string | undefined): JsonRpcErrorObject | undefined {
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

export async function safeAuthMessage(response: Response): Promise<string> {
  const body = await safeReadText(response);
  const parsed = tryParseJsonRpcError(body);
  if (parsed) return parsed.message;
  return body ? truncate(body) : "Authentication failed.";
}

export function classifyRpcError(err: JsonRpcErrorObject): McpError {
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

export function toResultFromJsonRpc(msg: JsonRpcResponseMsg): McpResult<unknown> {
  if (msg.error) return { ok: false, error: classifyRpcError(msg.error) };
  return { ok: true, value: msg.result };
}

export async function classifyHttpErrorResponse(response: Response): Promise<McpError> {
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

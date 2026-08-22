// JSON-RPC 2.0 envelopes on the wire, and the mapping from a server's
// failure into the domain's `McpError` vocabulary (card 76; moved unchanged
// from src/lib/mcp/client.ts).
//
// This is the file that keeps decisions/29's "nothing in src/domain ever
// sees an HTTP status or a fetch rejection" true for the MCP side: an HTTP
// status, a JSON-RPC `error` object and a malformed body all become an
// `McpError` here, and nothing above this layer looks at a `Response` again.

import { fail, ok, type Result } from "../../domain/result";
import type { McpError } from "../../domain/tools";
import { PROTOCOL_VERSION } from "./protocol";

// TODO: clean-code - 0.3 - DRY: this isRecord predicate is reimplemented independently seven times across src/ (chrome-storage/area.ts, chrome-runtime/protocol.ts, ollama/client.ts, openai/index.ts, content/relay.ts, sidepanel/presentation/untrustedJson.ts). Card 96 took it from ten: sw.ts's two message guards now reuse chrome-runtime/protocol.ts's own isRuntimeMessage, and the three tool-inspector components share sidepanel/presentation/untrustedJson.ts. The five that remain are held apart by adapters-do-not-import-adapters (each adapter stack would have to reach into another's folder) — collapsing them needs a home in src/domain, which is a decision record, not a drive-by.
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
    isRecord(v) && v.jsonrpc === "2.0" && (Object.hasOwn(v, "result") || Object.hasOwn(v, "error"))
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
    const requested =
      data && typeof data.requested === "string" ? data.requested : PROTOCOL_VERSION;
    // `McpError`'s `"protocol-mismatch".supported` (src/domain/tools, not
    // this folder's to widen) is optional without `| undefined` —
    // conditional spread so an absent list omits the key instead of
    // assigning it `undefined`.
    return {
      kind: "protocol-mismatch",
      requested,
      ...(supported !== undefined && { supported }),
      message: err.message,
    };
  }
  return { kind: "rpc-error", code: err.code, message: err.message, data: err.data };
}

export function toResultFromJsonRpc(msg: JsonRpcResponseMsg): Result<unknown, McpError> {
  if (msg.error) return fail(classifyRpcError(msg.error));
  return ok(msg.result);
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

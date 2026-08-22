// What "an already-initialized connection to one MCP server" means to the
// rest of this adapter, and the `initialize` result validation both
// transports share (card 76; moved unchanged from src/lib/mcp/client.ts).
//
// `McpWireSession` is never exported past ./index.ts: a caller only ever
// sees the four `McpToolGateway` methods, each of which builds one session,
// uses it once, and closes it (see ./gateway.ts's module doc for why there
// is no long-lived connection object).

import { fail, ok, type Result } from "../../domain/result";
import type { McpConnectionInfo, McpError, McpServerInfo } from "../../domain/tools";
import { classifyRpcError, isRecord, type JsonRpcResponseMsg } from "./json-rpc";
import { PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS, type McpClientInfo } from "./protocol";

/** One more JSON-RPC request/notification to an already-initialized server, implemented once per transport (./streamable-http.ts, ./legacy-sse.ts). */
export interface McpWireSession {
  readonly connection: McpConnectionInfo;
  request(method: string, params?: unknown): Promise<Result<unknown, McpError>>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): void;
}

export function initializeParams(clientInfo: McpClientInfo): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: clientInfo.name, version: clientInfo.version },
  };
}

function normalizeServerInfo(raw: unknown): McpServerInfo | undefined {
  if (!isRecord(raw) || typeof raw.name !== "string") return undefined;
  // `McpServerInfo.version` (src/domain/tools, not this folder's to widen)
  // is optional without `| undefined` — conditional spread so a missing
  // version omits the key instead of assigning it `undefined`.
  const version = typeof raw.version === "string" ? raw.version : undefined;
  return {
    name: raw.name,
    title: typeof raw.title === "string" ? raw.title : undefined,
    ...(version !== undefined && { version }),
  };
}

export function validateInitializeResult(
  response: JsonRpcResponseMsg,
): Result<McpConnectionInfo, McpError> {
  if (response.error) return fail(classifyRpcError(response.error));

  const result = response.result;
  if (!isRecord(result) || typeof result.protocolVersion !== "string") {
    return fail({
      kind: "invalid-response",
      message: "initialize response was missing protocolVersion.",
    });
  }
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(result.protocolVersion)) {
    return fail({
      kind: "protocol-mismatch",
      requested: PROTOCOL_VERSION,
      supported: [...SUPPORTED_PROTOCOL_VERSIONS],
      message: `Server negotiated protocol version "${result.protocolVersion}", which this client does not support (supports ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}).`,
    });
  }
  // `McpConnectionInfo.serverInfo`/`.instructions` (src/domain/tools, not
  // this folder's to widen) are optional without `| undefined` —
  // conditional spread so an absent value omits the key instead of
  // assigning it `undefined`.
  const serverInfo = normalizeServerInfo(result.serverInfo);
  const instructions = typeof result.instructions === "string" ? result.instructions : undefined;
  return ok({
    protocolVersion: result.protocolVersion,
    ...(serverInfo !== undefined && { serverInfo }),
    ...(instructions !== undefined && { instructions }),
  });
}

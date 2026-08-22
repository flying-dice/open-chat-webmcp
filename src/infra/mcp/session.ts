// What "an already-initialized connection to one MCP server" means to the
// rest of this adapter, and the `initialize` result validation both
// transports share (card 76; moved unchanged from src/lib/mcp/client.ts).
//
// `McpWireSession` is never exported past ./index.ts: a caller only ever
// sees the four `McpToolGateway` methods, each of which builds one session,
// uses it once, and closes it (see ./gateway.ts's module doc for why there
// is no long-lived connection object).

import type { McpConnectionInfo, McpResult, McpServerInfo } from "../../domain/tools";
import { classifyRpcError, isRecord, type JsonRpcResponseMsg } from "./json-rpc";
import { PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS, type McpClientInfo } from "./protocol";

/** One more JSON-RPC request/notification to an already-initialized server, implemented once per transport (./streamable-http.ts, ./legacy-sse.ts). */
export interface McpWireSession {
  readonly connection: McpConnectionInfo;
  request(method: string, params?: unknown): Promise<McpResult<unknown>>;
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
  return {
    name: raw.name,
    title: typeof raw.title === "string" ? raw.title : undefined,
    version: typeof raw.version === "string" ? raw.version : undefined,
  };
}

export function validateInitializeResult(
  response: JsonRpcResponseMsg,
): McpResult<McpConnectionInfo> {
  if (response.error) return { ok: false, error: classifyRpcError(response.error) };

  const result = response.result;
  if (!isRecord(result) || typeof result.protocolVersion !== "string") {
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        message: "initialize response was missing protocolVersion.",
      },
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

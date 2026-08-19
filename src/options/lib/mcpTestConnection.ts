// "Test connection" for the MCP server registry UI (card 39,
// decisions/14-backend-mcp-servers.md). Resolves through
// `discoverAllServerTools` (src/lib/mcp/client.ts) called with a single
// server — that function already does exactly what the card asks for in
// one round trip: a real `initialize` handshake AND a `tools/list`, bundled
// into one `McpServerDiscovery` entry carrying both the negotiated
// connection info and the discovered tools. Reusing it here (rather than
// calling `testServerConnection` and `listServerTools` separately) means
// "test connection" exercises the exact same code path card 38's tool-merge
// step uses, and gets the tool list back for free instead of a second round
// trip.
//
// The point of this module, per the card: collapse nothing. `McpError`
// (src/lib/mcp/types.ts) already distinguishes unreachable, timeout, auth,
// "not an MCP endpoint", protocol mismatch, an RPC-level error, and a
// malformed response — every one of those gets its own outcome kind below,
// carried straight through with the client's own message, rather than one
// generic "connection failed". User-facing WORDING for each kind lives in
// mcpTestResultDisplay.ts, not here — this module only classifies.

import { discoverAllServerTools, type McpCallOptions } from "../../lib/mcp/client";
import type { McpServerConfig } from "../../lib/mcp/registry";
import type { McpConnectionInfo, McpTool } from "../../lib/mcp/types";

export type McpTestOutcome =
  | { kind: "success"; connection: McpConnectionInfo; tools: McpTool[] }
  | { kind: "unreachable"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "auth"; message: string }
  | { kind: "not-mcp-endpoint"; message: string }
  | { kind: "protocol-mismatch"; message: string }
  | { kind: "rpc-error"; message: string }
  | { kind: "invalid-response"; message: string }
  | { kind: "aborted" }
  | { kind: "permission-denied"; message: string };

/**
 * Run the actual connectivity probe against `config`: a real handshake plus
 * `tools/list`. Assumes the caller has already secured any host permission
 * `config.url` needs (see src/lib/permissions.ts) — this function makes no
 * permission decisions itself, so it can be reused to test an unsaved draft
 * config as easily as a persisted one (mirrors
 * src/options/lib/testConnection.ts's `testProviderConnection` for the same
 * reason).
 */
export async function testMcpServerConnection(
  config: McpServerConfig,
  opts?: McpCallOptions,
): Promise<McpTestOutcome> {
  const [result] = await discoverAllServerTools([config], opts);
  if (result.status === "ok") {
    return { kind: "success", connection: result.connection, tools: result.tools };
  }

  const error = result.error;
  switch (error.kind) {
    case "unreachable":
      return { kind: "unreachable", message: error.message };
    case "timeout":
      return { kind: "timeout", message: error.message };
    case "aborted":
      return { kind: "aborted" };
    case "auth":
      return { kind: "auth", message: error.message };
    case "not-mcp-endpoint":
      return { kind: "not-mcp-endpoint", message: error.message };
    case "protocol-mismatch":
      return { kind: "protocol-mismatch", message: error.message };
    case "rpc-error":
      return { kind: "rpc-error", message: `(${error.code}) ${error.message}` };
    case "invalid-response":
      return { kind: "invalid-response", message: error.message };
    case "permission":
      // Card 38 added this `McpError` kind (src/lib/mcp/types.ts) for its
      // own out-of-band permission check (decisions/19 §4) — client.ts
      // itself never produces it, so this arm is unreachable from a real
      // `discoverAllServerTools` call today. Handled anyway so the switch
      // stays exhaustive against the shared `McpError` union, and so this
      // module keeps working unchanged if a future caller ever does check
      // permission before calling this test.
      return { kind: "permission-denied", message: error.message };
  }
}

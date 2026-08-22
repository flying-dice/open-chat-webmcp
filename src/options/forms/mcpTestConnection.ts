// "Test connection" for the MCP server registry UI (card 39,
// decisions/14-backend-mcp-servers.md). Resolves through the
// `McpToolGateway` port's `discoverAllServerTools` (src/domain/tools) called
// with a single server — that method already does exactly what the card asks
// for in
// one round trip: a real `initialize` handshake AND a `tools/list`, bundled
// into one `McpServerDiscovery` entry carrying both the negotiated
// connection info and the discovered tools. Reusing it here (rather than
// calling `testServerConnection` and `listServerTools` separately) means
// "test connection" exercises the exact same code path card 38's tool-merge
// step uses, and gets the tool list back for free instead of a second round
// trip.
//
// The point of this module, per the card: collapse nothing. `McpError`
// (src/domain/tools) already distinguishes unreachable, timeout, auth,
// "not an MCP endpoint", protocol mismatch, an RPC-level error, and a
// malformed response — every one of those gets its own outcome kind below,
// carried straight through with the client's own message, rather than one
// generic "connection failed". User-facing WORDING for each kind lives in
// ./testResultDisplay.ts, not here — this module only classifies.

import type {
  McpCallOptions,
  McpConnectionInfo,
  McpServerConfig,
  McpTool,
} from "../../domain/tools";
import { optionsServices } from "../app-services";

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
 * `config.url` needs (`HostPermissions`, src/domain/permissions) — this function makes no
 * permission decisions itself, so it can be reused to test an unsaved draft
 * config as easily as a persisted one (mirrors
 * src/options/forms/providerTestConnection.ts's `testProviderConnection` for the same
 * reason).
 */
export async function testMcpServerConnection(
  config: McpServerConfig,
  opts?: McpCallOptions,
): Promise<McpTestOutcome> {
  const results = await optionsServices().mcpTools.discoverAllServerTools([config], opts);
  const result = results[0];
  if (!result) {
    // `discoverAllServerTools` returns one entry per config passed in
    // (src/domain/tools/gateway.ts) — a single-element input array that
    // comes back empty would be a bug in that contract, not a reachable
    // outcome of testing a connection.
    throw new Error("discoverAllServerTools returned no result for a single config");
  }
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
      // Card 38 added this `McpError` kind (src/domain/tools) for its
      // own out-of-band permission check (decisions/19 §4) — the transport
      // itself never produces it, so this arm is unreachable from a real
      // `discoverAllServerTools` call today. Handled anyway so the switch
      // stays exhaustive against the shared `McpError` union, and so this
      // module keeps working unchanged if a future caller ever does check
      // permission before calling this test.
      return { kind: "permission-denied", message: error.message };
    // Card 94 widened `McpError` with four OAuth-flow-specific kinds
    // (discovery/registration/refresh/user-cancel). `discoverAllServerTools`
    // can reach `"refresh-expired"` for an oauth-configured server whose
    // refresh grant fails mid-connect; the other three are only ever
    // produced by the interactive sign-in flow (src/domain/tools/sign-in.ts),
    // never by this test-connection path — handled anyway so this switch
    // stays exhaustive against the shared union.
    case "refresh-expired":
      return { kind: "auth", message: error.message };
    case "discovery-absent":
    case "registration-rejected":
      return { kind: "invalid-response", message: error.message };
    case "user-cancelled":
      return { kind: "aborted" };
  }
}

// `McpToolGateway` (src/domain/tools), implemented over MCP's two HTTP-based
// transports — never stdio, never a helper process (a browser extension
// can't spawn one). Card 76 moved this from src/lib/mcp/client.ts; the four
// operations, their budgets and their failure isolation are unchanged.
//
// Design: every method is a SELF-CONTAINED round trip — connect (initialize
// handshake), do exactly one thing (list tools / call one tool / just verify
// reachability), then close. There is no persistent connection object for a
// caller to hold, leak, or forget to close, which is the "hard to misuse"
// shape decisions/14 asked for at the cost of re-running the handshake on
// every call. For a browser-extension agent loop calling tools occasionally
// rather than a long-lived server-to-server client, that trade favors
// correctness (no dangling session state, no reconnect logic) over saving one
// round trip.
//
// Never-throw discipline: every method resolves the shared `Result<T, McpError>`
// (src/domain/result) and rejects for nothing — including on a malformed or
// hostile server response. The error vocabulary is the domain's
// (src/domain/tools/types.ts), a deliberate parallel to `ProviderError`
// rather than a re-export.
//
// Per-server failure isolation (decisions/14: a slow server "must never stop
// the page's own tools from being offered"): every operation carries its own
// timeout budget (./budget.ts), and `discoverAllServerTools` runs every
// server concurrently via `Promise.all` over calls that themselves never
// reject — one dead or slow server resolves to a `status: "error"` entry
// within its own budget rather than rejecting the batch or blocking a faster
// server's result.
//
// WIRING: the only two things this adapter needs from outside are an
// `McpTokenResolver` (to turn an oauth config into an `Authorization` header,
// refreshing when due) and the `clientInfo` it announces in the handshake.
// Both arrive at construction. Nothing here imports another adapter, and
// nothing here reads storage.

import { ok, type Result } from "../../domain/result";
import type {
  McpCallOptions,
  McpConnectionInfo,
  McpError,
  McpServerConfig,
  McpServerDiscovery,
  McpTokenResolver,
  McpTool,
  McpToolCallResult,
  McpToolGateway,
} from "../../domain/tools";
import { createBudget } from "./budget";
import { connect, type McpTransportContext } from "./connect";
import { DEFAULT_CLIENT_INFO, type McpClientInfo } from "./protocol";
import { callToolViaSession, listToolsViaSession } from "./results";
import {
  DEFAULT_CALL_TOOL_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DEFAULT_LIST_TOOLS_TIMEOUT_MS,
} from "./timeouts";

export interface McpToolGatewayOptions {
  /** Turns an oauth-configured server into a currently-valid token, refreshing when due. `createMcpOAuthClient` (./oauth.ts) is the implementation; the gateway depends on the narrow resolver so it never reaches the interactive sign-in flow. */
  auth: McpTokenResolver;
  /** What this client announces as `clientInfo` in the `initialize` handshake. Defaults to the build-time app name/version (./protocol.ts). */
  clientInfo?: McpClientInfo;
}

/** Build the one `McpToolGateway` a runtime surface uses. Holds no mutable state, so building a second one is harmless — but pointless. */
export function createMcpToolGateway(options: McpToolGatewayOptions): McpToolGateway {
  const ctx: McpTransportContext = {
    auth: options.auth,
    clientInfo: options.clientInfo ?? DEFAULT_CLIENT_INFO,
  };

  async function testServerConnection(
    config: McpServerConfig,
    opts?: McpCallOptions,
  ): Promise<Result<McpConnectionInfo, McpError>> {
    const budget = createBudget(opts?.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS, opts?.signal);
    try {
      const [session, err] = await connect(config, ctx, budget);
      if (err) return [undefined, err];
      session.close();
      return ok(session.connection);
    } finally {
      budget.cleanup();
    }
  }

  async function listServerTools(
    config: McpServerConfig,
    opts?: McpCallOptions,
  ): Promise<Result<McpTool[], McpError>> {
    const budget = createBudget(opts?.timeoutMs ?? DEFAULT_LIST_TOOLS_TIMEOUT_MS, opts?.signal);
    try {
      const [session, err] = await connect(config, ctx, budget);
      if (err) return [undefined, err];
      try {
        return await listToolsViaSession(session);
      } finally {
        session.close();
      }
    } finally {
      budget.cleanup();
    }
  }

  async function callServerTool(
    config: McpServerConfig,
    toolName: string,
    args: Record<string, unknown> | undefined,
    opts?: McpCallOptions,
  ): Promise<Result<McpToolCallResult, McpError>> {
    const budget = createBudget(opts?.timeoutMs ?? DEFAULT_CALL_TOOL_TIMEOUT_MS, opts?.signal);
    try {
      const [session, err] = await connect(config, ctx, budget);
      if (err) return [undefined, err];
      try {
        return await callToolViaSession(session, toolName, args);
      } finally {
        session.close();
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
      const [session, sessionErr] = await connect(config, ctx, budget);
      if (sessionErr) {
        return {
          status: "error",
          serverId: config.id,
          serverName: config.name,
          error: sessionErr,
        };
      }
      try {
        const [tools, toolsErr] = await listToolsViaSession(session);
        if (toolsErr) {
          return {
            status: "error",
            serverId: config.id,
            serverName: config.name,
            error: toolsErr,
          };
        }
        return {
          status: "ok",
          serverId: config.id,
          serverName: config.name,
          connection: session.connection,
          tools,
        };
      } finally {
        session.close();
      }
    } catch (err) {
      // Belt-and-suspenders: this must never throw and never let one
      // server's bug take down the whole batch (decisions/14) — everything
      // above already returns `Result`/never-throw shapes, but a defensive
      // catch here means a bug in this adapter itself still degrades to one
      // failed server entry instead of an unhandled rejection in
      // `discoverAllServerTools`'s `Promise.all`.
      return {
        status: "error",
        serverId: config.id,
        serverName: config.name,
        error: {
          kind: "invalid-response",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    } finally {
      budget.cleanup();
    }
  }

  return {
    testServerConnection,
    listServerTools,
    callServerTool,
    async discoverAllServerTools(servers, opts) {
      return Promise.all(servers.map((server) => discoverOneServer(server, opts)));
    },
  };
}

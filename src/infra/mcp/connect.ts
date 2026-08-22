// Transport selection (card 76; moved unchanged from src/lib/mcp/client.ts's
// `connect`).
//
// Resolve the auth header first — for an oauth config that is where a due
// token gets refreshed, and a refusal short-circuits the whole call before a
// single request is attempted — then try the modern transport unless the
// config pins `"sse"`, falling back to the legacy one only on the spec's
// documented 404/405 signal.

import { fail, ok, type Result } from "../../domain/result";
import type { McpError, McpServerConfig, McpTokenResolver } from "../../domain/tools";
import type { Budget } from "./budget";
import { buildBaseHeaders, resolveAuthHeader } from "./headers";
import { connectLegacySse } from "./legacy-sse";
import type { McpClientInfo } from "./protocol";
import type { McpWireSession } from "./session";
import { tryStreamableHttp } from "./streamable-http";

/** What every connect attempt needs beyond the server's own config — supplied once when the gateway is constructed, never looked up. */
export interface McpTransportContext {
  auth: McpTokenResolver;
  clientInfo: McpClientInfo;
}

export async function connect(
  config: McpServerConfig,
  ctx: McpTransportContext,
  budget: Budget,
): Promise<Result<McpWireSession, McpError>> {
  const [authHeader, authErr] = await resolveAuthHeader(config, ctx.auth);
  if (authErr) return fail(authErr);
  const baseHeaders = buildBaseHeaders(config, authHeader);

  if (config.transport !== "sse") {
    const attempt = await tryStreamableHttp(config, baseHeaders, ctx.clientInfo, budget);
    if (attempt.outcome === "connected") return ok(attempt.session);
    if (attempt.outcome === "failed") return fail(attempt.error);
    // outcome === "try-legacy": only reachable with transport === "auto".
  }

  if (config.transport === "streamable-http") {
    // tryStreamableHttp always returns "connected" or "failed" for a config
    // pinned to this transport — "try-legacy" is unreachable above in that
    // case — but keep a defensive fallback rather than falling through to
    // an unrelated transport attempt.
    return fail({
      kind: "not-mcp-endpoint",
      message: "Streamable HTTP handshake did not complete.",
    });
  }

  return connectLegacySse(config, baseHeaders, ctx.clientInfo, budget);
}

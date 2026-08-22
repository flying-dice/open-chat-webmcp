// The headers one server's requests carry (card 76; moved unchanged from
// src/lib/mcp/client.ts), including decisions/15's reserved-header safety
// net and the two auth modes.
//
// The one CHANGE card 76 makes: resolving an oauth `Authorization` header no
// longer reaches for a module-level OAuth singleton — it takes an
// `McpTokenResolver` (src/domain/tools), which is what lets the OAuth half of
// this adapter be constructed with its own injected token store instead of
// importing one.

import { fail, ok, type Result } from "../../domain/result";
import type { McpError, McpServerConfig, McpTokenResolver } from "../../domain/tools";
import { CLIENT_CONTROLLED_HEADERS } from "../../domain/tools";

/** Whether resolving this config's auth will ever put an `Authorization` header on the wire — true for a non-empty bearer token, and unconditionally true for oauth (once resolved, it always contributes one; see {@link resolveAuthHeader}). Used only to decide whether a custom `authorization` header must be dropped as reserved, below — it does not itself produce the header. */
function hasResolvableAuth(config: McpServerConfig): boolean {
  if (!config.auth) return false;
  return config.auth.type === "bearer" ? config.auth.token.length > 0 : true;
}

/**
 * Custom headers from a server config, with any reserved name dropped —
 * defense-in-depth so a config that slipped past `validateServerHeaders`
 * (src/domain/tools) (e.g. one written before that check existed, or by a
 * foreign tool touching storage directly) still can't override what the
 * client controls for correctness. The visible "refuse at edit time" UX
 * decision 15 asks for is the options form's job; this is the silent-drop
 * safety net underneath it.
 */
function effectiveCustomHeaders(config: McpServerConfig): Record<string, string> {
  const headers = config.headers ?? {};
  const reserved = new Set<string>(CLIENT_CONTROLLED_HEADERS);
  if (hasResolvableAuth(config)) reserved.add("authorization");
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (reserved.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}

/** The bearer-token `Authorization` header, unchanged from before oauth support existed — a pure, synchronous mapping used only for `config.auth.type === "bearer"`. The oauth case is handled by {@link resolveAuthHeader}, which never calls this. */
function authHeader(config: McpServerConfig): Record<string, string> {
  return config.auth?.type === "bearer" && config.auth.token
    ? { Authorization: `Bearer ${config.auth.token}` }
    : {};
}

/**
 * Resolve the `Authorization` header for either auth type ahead of a connect
 * attempt. For a bearer config this is exactly `authHeader(config)` — a
 * synchronous mapping simply wrapped in a resolved promise, so the bearer
 * path's headers, and the order the connect step builds them in, are
 * unchanged from before oauth support existed. For an oauth config, asks the
 * injected {@link McpTokenResolver} for a currently-valid token (refreshing
 * it if it is due, and persisting that refresh through ITS own token-store
 * port) and maps success to a `Bearer` header or failure to an early
 * `Result` error the connect step returns as-is, before ever attempting a
 * request.
 */
export async function resolveAuthHeader(
  config: McpServerConfig,
  auth: McpTokenResolver,
): Promise<Result<Record<string, string>, McpError>> {
  if (config.auth?.type !== "oauth") {
    return ok(authHeader(config));
  }
  const [valid, err] = await auth.getValidAuth(config);
  if (err) return fail(err);
  return ok({ Authorization: `Bearer ${valid.accessToken}` });
}

/** Every header this server's requests carry except the transport-controlled `Content-Type`/`Accept`, which each call site sets itself (GET vs. POST need different values) and which always wins by being spread last. `authHeaderValue` comes from {@link resolveAuthHeader} and is spread last here too. */
export function buildBaseHeaders(
  config: McpServerConfig,
  authHeaderValue: Record<string, string>,
): Record<string, string> {
  return { ...effectiveCustomHeaders(config), ...authHeaderValue };
}

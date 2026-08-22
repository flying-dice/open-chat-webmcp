// The MCP OPERATION ports (card 76, decisions/29): what a surface may ask of
// a remote MCP server, stated as interfaces this context owns, so nothing
// outside src/infra/mcp ever names the HTTP client module.
//
// ./servers.ts models what a configured server IS and how it is stored;
// ./types.ts owns the error/result vocabulary those operations speak. This
// file is the third side of that triangle: the verbs.
//
//   `McpToolGateway`  — the transport port. Connect and verify, list, call,
//                       discover-across-every-server. Implemented by
//                       src/infra/mcp; consumed by
//                       src/sidepanel/services/mcpTools.ts and
//                       src/options/lib/mcpTestConnection.ts.
//   `McpOAuthClient`  — the OAuth 2.1 + PKCE port (decisions/27). Discovery,
//                       dynamic registration, the interactive sign-in flow,
//                       and `getValidAuth`'s refresh. Implemented by
//                       src/infra/mcp; consumed by the options page's
//                       server form and, for `getValidAuth` alone, by the
//                       gateway itself (hence the narrower
//                       {@link McpTokenResolver} it depends on).
//
// Both are NEVER-THROWS ports: every method resolves an `McpResult` and
// rejects for nothing (./types.ts). That is a deliberate difference from the
// storage ports of decisions/32, which throw `StorageError` — an MCP
// operation talks to a third party the user configured, so "it failed and
// here is which way" is an ordinary outcome a caller must handle, not an
// exceptional one.
//
// Pure TypeScript: an `AbortSignal` is the only platform type named below,
// and it is a value the CALLER already holds — the domain neither creates
// one nor touches `chrome.*`, `fetch` or the DOM.

import type { McpOAuthAuth, McpServerConfig } from "./servers";
import type {
  McpConnectionInfo,
  McpResult,
  McpServerDiscovery,
  McpTool,
  McpToolCallResult,
} from "./types";

// ---------------------------------------------------------------------------
// The transport port
// ---------------------------------------------------------------------------

export interface McpCallOptions {
  /** The caller's own cancellation. Distinct from the operation timing out — see `McpError`'s `"aborted"` vs `"timeout"`. */
  signal?: AbortSignal;
  /** Override the adapter's default budget for this one call. Omitted uses the per-operation default (src/infra/mcp/timeouts.ts). */
  timeoutMs?: number;
}

/**
 * Everything the app does WITH a configured MCP server. One implementation
 * (src/infra/mcp) speaks protocol 2025-06-18 over Streamable HTTP with the
 * legacy HTTP+SSE fallback; a surface only ever sees these four methods.
 *
 * Each call is a self-contained round trip — connect, do one thing, close —
 * so there is no connection object for a caller to hold, leak, or forget to
 * close, and no `close()` on this port to forget to call.
 */
export interface McpToolGateway {
  /** Verify a config is reachable and speaks MCP, without listing or calling anything. Resolves the negotiated protocol version and the server's identity. */
  testServerConnection(
    config: McpServerConfig,
    opts?: McpCallOptions,
  ): Promise<McpResult<McpConnectionInfo>>;

  /** Every tool one server currently offers, paginated through internally. */
  listServerTools(config: McpServerConfig, opts?: McpCallOptions): Promise<McpResult<McpTool[]>>;

  /** Invoke one tool on one server. `isError: true` inside an `ok: true` result is the TOOL's own reported failure (the spec's two-tier error model); only a transport/protocol failure is `ok: false`. */
  callServerTool(
    config: McpServerConfig,
    toolName: string,
    args: Record<string, unknown> | undefined,
    opts?: McpCallOptions,
  ): Promise<McpResult<McpToolCallResult>>;

  /**
   * Discover tools across many servers concurrently, one entry per server.
   * Never rejects and never lets one server affect another
   * (decisions/14: a dead server "must never stop the page's own tools from
   * being offered") — a failure becomes a `status: "error"` entry inside
   * that server's own timeout budget.
   */
  discoverAllServerTools(
    servers: McpServerConfig[],
    opts?: McpCallOptions,
  ): Promise<McpServerDiscovery[]>;
}

// ---------------------------------------------------------------------------
// The OAuth port (decisions/27-oauth-for-http-mcp-servers.md)
// ---------------------------------------------------------------------------

/** The authorization-server metadata this app deals in — a deliberate subset of RFC 8414's full document, exactly the endpoints the flow needs, and exactly what `McpOAuthAuth` caches so a reconnect never re-runs discovery. */
export type McpAuthorizationServerInfo = McpOAuthAuth["authorizationServer"];

/** What RFC 7591 dynamic client registration hands back. Always a PUBLIC client (`token_endpoint_auth_method: "none"`), but a server may return a `client_secret` anyway and it is carried through rather than dropped. */
export interface McpDynamicClientRegistration {
  clientId: string;
  clientSecret?: string;
}

export interface McpOAuthFlowConfig {
  /** The MCP server's own URL — the RFC 8707 `resource` on both the authorization and token requests, and stored on the resulting auth so a refresh can re-send it. */
  serverUrl: string;
  clientId: string;
  clientSecret?: string;
  /** Space-separated scopes to request. Omitted asks for whatever the authorization server defaults to. */
  scope?: string;
}

/**
 * The one thing the TRANSPORT needs from OAuth: a currently-valid token for
 * a server about to be contacted, refreshed first if it is due. Split out
 * from the full {@link McpOAuthClient} so `McpToolGateway`'s implementation
 * depends on refresh alone and never on the interactive sign-in flow —
 * which needs a user gesture and so can only ever be driven from a click
 * handler.
 */
export interface McpTokenResolver {
  /**
   * A valid oauth auth for `config`, refreshing via the RFC 6749 §6
   * `refresh_token` grant when the stored one is due. Persisting a refreshed
   * token is the implementation's business (see {@link McpAuthTokenStore});
   * a caller only ever reads the returned value.
   *
   * A missing refresh token, or a refused refresh grant, surfaces as
   * `kind: "auth"` — the same kind an expired bearer token produces, so
   * nothing downstream needs a new error kind for "reconnect needed".
   */
  getValidAuth(config: McpServerConfig): Promise<McpResult<McpOAuthAuth>>;
}

/**
 * The whole discovery -> registration -> authorize -> refresh chain
 * decisions/27 calls for, and no more (manual client_id entry and
 * `WWW-Authenticate`-challenge discovery are out of scope there).
 */
export interface McpOAuthClient extends McpTokenResolver {
  /**
   * The redirect URI this extension's authorization flow comes back to — the
   * value an authorization server must have registered for the sign-in to be
   * accepted, and therefore the value the manual-app-registration panel
   * (McpServerForm.svelte) shows the user to copy.
   *
   * Part of the PORT rather than something a UI derives, because it is the
   * SAME string {@link McpOAuthClient.runAuthorizationFlow} sends as
   * `redirect_uri`: a form that computed it independently could drift from
   * what the flow actually uses, and the only symptom would be an
   * authorization server rejecting the callback. Card 78 moved it here from a
   * direct `chrome.identity.getRedirectURL()` call in that component — the
   * last `chrome.identity` site outside src/infra/mcp.
   */
  redirectUri(): string;

  /** RFC 9728 then RFC 8414: resolve the authorization server for an MCP server's URL. */
  discoverAuthorizationServer(mcpServerUrl: string): Promise<McpResult<McpAuthorizationServerInfo>>;

  /** RFC 7591: register this extension as a public client at a discovered `registration_endpoint`. */
  registerClient(
    registrationEndpoint: string,
    redirectUri: string,
  ): Promise<McpResult<McpDynamicClientRegistration>>;

  /**
   * RFC 6749 §4.1 + RFC 7636 + RFC 8707: drive the interactive
   * authorization-code + PKCE flow end to end and exchange the code for a
   * token set.
   *
   * MUST be called from within a user gesture — the implementation opens a
   * browser sign-in window — so a caller should not `await` unrelated work
   * ahead of it.
   */
  runAuthorizationFlow(
    config: McpOAuthFlowConfig,
    discovery: McpAuthorizationServerInfo,
  ): Promise<McpResult<McpOAuthAuth>>;
}

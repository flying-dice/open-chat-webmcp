// Shared vocabulary for the MCP client (decisions/14-backend-mcp-servers.md).
// The error/result half of this bounded context, alongside ./gateway.ts (the
// operations) and ./servers.ts (the configured servers and their storage
// port). Deliberately does not import anything from
// src/domain/providers/provider.ts: the shapes below are a parallel,
// MCP-specific vocabulary rather than a re-export or an extension of that
// file. Where they are conceptually similar (`McpError` / `ProviderError`),
// that is a deliberate mirror of src/domain/providers/provider.ts's
// never-throw discipline, not a shared type.
//
// Wire format target: MCP protocol version "2025-06-18" (the current spec at
// https://modelcontextprotocol.io/specification/2025-06-18/), with the
// client accepting a small set of known-compatible earlier versions a server
// negotiates down to — see SUPPORTED_PROTOCOL_VERSIONS in
// src/infra/mcp/protocol.ts.

// ---------------------------------------------------------------------------
// Never-throw result plumbing (card 94, decisions/34-errors-as-values.md):
// every MCP operation resolves the shared `Result<T, McpError>` tuple
// (../result) rather than the bespoke `{ok:true,value}|{ok:false,error}`
// record this module used to declare as `McpResult`. That record shape is
// gone — every signature below spells out `Result<T, McpError>` directly,
// the same way the storage ports (../storage) spell out
// `Result<T, StorageError>` rather than naming a `StorageResult` alias.
// ---------------------------------------------------------------------------

/**
 * Every named failure mode an MCP operation (connect, list, call) can report
 * — never a thrown exception. Kinds are deliberately specific rather than a
 * bare string/message, per the card: a UI or the agent loop should be able to
 * branch on `kind` without parsing prose.
 *
 *   - `"unreachable"`: the endpoint could not be reached at all (network
 *     failure, DNS, connection refused) or a blocked CORS preflight — like
 *     src/infra/openai's `"unreachable-or-cors"`, a `fetch`
 *     TypeError can't distinguish "host permission not granted" from
 *     "genuinely down", so both land here with a message that names both
 *     possibilities.
 *   - `"timeout"`: this operation's own timeout budget (see
 *     src/infra/mcp/timeouts.ts) elapsed before the server responded. Distinct from `"aborted"` (the
 *     *caller* cancelled) so a UI can say "server was too slow" rather than
 *     "cancelled".
 *   - `"aborted"`: the caller's own `AbortSignal` fired.
 *   - `"auth"`: the server rejected the request as unauthenticated/
 *     unauthorized (HTTP 401/403, or a JSON-RPC error that says as much).
 *   - `"not-mcp-endpoint"`: the URL answered, but not with anything that
 *     looks like an MCP JSON-RPC server — wrong content type, HTML error
 *     page, JSON that isn't a JSON-RPC envelope. Distinct from `"unreachable"`
 *     so the message can say "this doesn't look like an MCP server" instead
 *     of "couldn't connect", which is a very different fix for the user.
 *   - `"protocol-mismatch"`: the server's `initialize` response named a
 *     protocol version this client doesn't recognize as compatible.
 *   - `"rpc-error"`: a well-formed JSON-RPC `error` object came back for a
 *     request past the initialize step (e.g. "Unknown tool", invalid
 *     params) — the server IS an MCP server, this one call just failed.
 *   - `"invalid-response"`: the server's response parsed as JSON-RPC but the
 *     `result` payload didn't match the shape this method expects.
 *   - `"permission"`: card 38's merge step (src/sidepanel/services/mcpTools.ts)
 *     checked `chrome.permissions.contains` for this server's origin BEFORE
 *     ever attempting a request and found it not granted. Distinct from
 *     `"unreachable"` on purpose (decisions/19 §4: "reported as unavailable
 *     with that specific reason, never as a generic failure") — this client
 *     module itself never produces this kind, since a blocked fetch here is
 *     indistinguishable from a dead host (see `"unreachable"`'s doc); only a
 *     caller that checked the permission first, out of band, can tell the
 *     two apart.
 *
 * Card 94 (decisions/27-oauth-for-http-mcp-servers.md,
 * decisions/34-errors-as-values.md) audited the OAuth flow's known-failure
 * vocabulary and split four cases that used to fold into the generic
 * "auth"/"invalid-response"/"not-mcp-endpoint" kinds above:
 *
 *   - `"discovery-absent"`: RFC 9728/RFC 8414 discovery
 *     (src/infra/mcp/oauth-metadata.ts) reached the server but found no
 *     authorization-server metadata document at all — a well-known URL that
 *     404s, rather than one that answers with something malformed
 *     (`"invalid-response"`) or unreachable (`"unreachable"`/`"timeout"`).
 *     Distinct so the sign-in UI can say "this server doesn't support
 *     discoverable OAuth" instead of a generic connection failure.
 *   - `"registration-rejected"`: RFC 7591 dynamic client registration
 *     (src/infra/mcp/oauth-metadata.ts's `registerClient`) reached the
 *     `registration_endpoint` and it explicitly refused the request (a
 *     non-2xx response). Distinct from `"invalid-response"`, which stays
 *     for a 2xx response that doesn't actually contain a `client_id` —
 *     that is a malformed server, this is a server saying no.
 *   - `"refresh-expired"`: the RFC 6749 §6 `refresh_token` grant
 *     (src/infra/mcp/oauth.ts's `getValidAuth`) failed, or there was no
 *     refresh token to try — the access token is unusable and the ONLY
 *     recovery is an interactive sign-in again. Distinct from `"auth"` so a
 *     caller can say "reconnect" rather than "check your credentials".
 *   - `"user-cancelled"`: the interactive `chrome.identity.launchWebAuthFlow`
 *     window (src/infra/mcp/oauth.ts's `runAuthorizationFlow`) was closed by
 *     the user, or the authorization server's redirect carried
 *     `error=access_denied` — the user declined, rather than anything
 *     failing. Distinct from `"aborted"` (the caller's own `AbortSignal`) and
 *     from `"auth"` (the server rejecting credentials it was given); no
 *     message, mirroring `"aborted"` — there is nothing more specific to say
 *     about a user closing a window.
 */
export type McpError =
  | { kind: "unreachable"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "aborted" }
  | { kind: "auth"; status?: number; message: string }
  | { kind: "not-mcp-endpoint"; message: string }
  | {
      kind: "protocol-mismatch";
      requested: string;
      supported?: string[];
      message: string;
    }
  | { kind: "rpc-error"; code: number; message: string; data?: unknown }
  | { kind: "invalid-response"; message: string }
  | { kind: "permission"; message: string }
  | { kind: "discovery-absent"; message: string }
  | { kind: "registration-rejected"; message: string }
  | { kind: "refresh-expired"; message: string }
  | { kind: "user-cancelled" };

/** Ready-made user-facing copy for an {@link McpError}, for UI that doesn't want to hand-roll it. Never includes header/credential values — see decisions/15-custom-headers-are-credentials.md. */
export function describeMcpError(error: McpError): string {
  switch (error.kind) {
    case "unreachable":
      return error.message;
    case "timeout":
      return error.message;
    case "aborted":
      return "Request was cancelled.";
    case "auth":
      return `Authentication failed${error.status ? ` (${error.status})` : ""}: ${error.message}`;
    case "not-mcp-endpoint":
      return error.message;
    case "protocol-mismatch":
      return error.message;
    case "rpc-error":
      return `Server returned an error (${error.code}): ${error.message}`;
    case "invalid-response":
      return `Server returned something this extension couldn't understand: ${error.message}`;
    case "permission":
      return error.message;
    case "discovery-absent":
      return `This server doesn't advertise a discoverable OAuth authorization server. ${error.message}`;
    case "registration-rejected":
      return `App registration was rejected: ${error.message}`;
    case "refresh-expired":
      return `Your session has expired: ${error.message} Sign in again.`;
    case "user-cancelled":
      return "Sign-in was cancelled.";
  }
}

// ---------------------------------------------------------------------------
// Tools (MCP "server/tools" — tools/list, tools/call)
// ---------------------------------------------------------------------------

/** Tool behavior hints per the MCP spec, read the same way page tool annotations are (decisions/14: "MCP tool annotations are used the same way page annotations are"). Per spec these are untrusted metadata the server asserts about itself, not a security boundary. */
export interface McpToolAnnotations {
  title?: string | undefined;
  readOnlyHint?: boolean | undefined;
  destructiveHint?: boolean | undefined;
  idempotentHint?: boolean | undefined;
  openWorldHint?: boolean | undefined;
  [key: string]: unknown;
}

/** A tool as offered by one MCP server's `tools/list`. */
export interface McpTool {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  inputSchema?: Record<string, unknown> | undefined;
  outputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotations | undefined;
}

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface McpAudioContent {
  type: "audio";
  data: string;
  mimeType: string;
}

export interface McpResourceLinkContent {
  type: "resource_link";
  uri: string;
  name?: string;
  description?: string | undefined;
  mimeType?: string;
}

export interface McpEmbeddedResourceContent {
  type: "resource";
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

/**
 * One item of a tool result's `content` array. Content types are per the
 * spec's fixed set; an item whose `type` this client doesn't recognize is
 * normalized to a `text` item carrying its raw JSON (see
 * src/infra/mcp/results.ts) rather
 * than dropped, so a future content type never silently disappears.
 */
export type McpToolContent =
  | McpTextContent
  | McpImageContent
  | McpAudioContent
  | McpResourceLinkContent
  | McpEmbeddedResourceContent;

/** Result of a `tools/call`, typed per the spec's two-tier error model: a protocol-level failure surfaces as the calling `Result<McpToolCallResult, McpError>`'s error side; a tool-level failure (the tool ran but reported an error) surfaces here as `isError: true` with the failure described in `content`. */
export interface McpToolCallResult {
  content: McpToolContent[];
  /** Present when the tool declared an `outputSchema` and returned structured data alongside the required text fallback (spec: "structuredContent"). */
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

// ---------------------------------------------------------------------------
// Server identity, surfaced alongside a successful `initialize`
// ---------------------------------------------------------------------------

export interface McpServerInfo {
  name: string;
  title?: string | undefined;
  version?: string;
}

/** What a successful connect (initialize handshake) resolves — used by `McpToolGateway.testServerConnection` (./gateway.ts) and by discovery results below. */
export interface McpConnectionInfo {
  protocolVersion: string;
  serverInfo?: McpServerInfo;
  instructions?: string;
}

// ---------------------------------------------------------------------------
// Per-server discovery result — the shape card 38's merge step consumes.
// One entry per configured, enabled server; a failing server contributes an
// `"error"` entry instead of being omitted, so callers (and any UI) can show
// *why* a server contributed no tools rather than have it silently vanish.
// ---------------------------------------------------------------------------

export type McpServerDiscovery =
  | {
      status: "ok";
      serverId: string;
      serverName: string;
      connection: McpConnectionInfo;
      tools: McpTool[];
    }
  | {
      status: "error";
      serverId: string;
      serverName: string;
      error: McpError;
    };

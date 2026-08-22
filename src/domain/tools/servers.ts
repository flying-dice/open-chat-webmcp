// Remote MCP servers as the domain models them (card 74,
// decisions/14-backend-mcp-servers.md,
// decisions/15-custom-headers-are-credentials.md): what a configured server
// IS, which of its fields are credentials, the reserved-header rule, and the
// driven port a surface reaches through to change any of it.
//
// This lives in the `tools` context rather than one of its own because a
// configured MCP server is not an end in itself — it exists solely to
// contribute tools to the one merged list a model sees (./merge.ts, whose
// `ToolServerIdentity` is the narrow `{id, name}` view of exactly this
// type). Splitting "the server list" from "the merge algebra that consumes
// it" would put a context boundary through the middle of one idea.
//
// The sync/local credential split (decisions/15) is stated here only as a
// TYPE fact — `auth` and `headers` are credentials — and enforced by the
// adapter that routes them (src/infra/chrome-storage/mcp-server-registry.ts).
//
// Every port method rejects with `StorageError` (src/domain/storage) and
// nothing else.

/** How a server's `initialize` handshake should be attempted. `"auto"` (the default) tries the modern Streamable HTTP transport first and falls back to the legacy HTTP+SSE transport per the spec's backwards-compatibility guidance — the two explicit values exist so a user (or a future diagnostics UI) can pin one down when auto-detection guesses wrong. */
export type McpTransportPreference = "auto" | "streamable-http" | "sse";

/** A static bearer token — the same shape as a provider's `apiKey` (decisions/10), stored the same way. */
export interface McpBearerAuth {
  type: "bearer";
  token: string;
}

/**
 * OAuth 2.1 (PKCE) tokens plus everything needed to refresh them without
 * re-running discovery (decisions/27-oauth-for-http-mcp-servers.md). Kept as
 * one object — no split between "secret" and "metadata" parts — since none
 * of it is meant to sync and a single local record already gives it the same
 * storage locality a bearer token gets. Built and refreshed by the OAuth
 * adapter; the registry only stores and reads it.
 */
export interface McpOAuthAuth {
  type: "oauth";
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. Absent means "unknown expiry" — treated as still valid until a 401 says otherwise. */
  expiresAt?: number;
  scope?: string;
  /** This extension's client id at `authorizationServer`, from dynamic client registration (RFC 7591) or a value the user supplied. Always a public client — no `token_endpoint_auth_method: "none"` peer ever needs a secret, but a server can hand one back anyway (see `clientSecret`). */
  clientId: string;
  clientSecret?: string;
  authorizationServer: {
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    registrationEndpoint?: string;
    /** Scopes the resource (preferred, from RFC 9728's `scopes_supported`) or the authorization server itself (RFC 8414's) advertises — the sign-in flow requests all of these, since the client has no other way to know what a given MCP server's tools need. Cached here alongside the other discovery output so a future reconnect doesn't have to re-fetch it. */
    scopesSupported?: string[];
  };
  /** The MCP server URL this token was scoped to via the RFC 8707 `resource` parameter — re-sent on refresh for the same anti-replay reason it's sent on the original authorization request. */
  resource?: string;
}

/** Optional auth for a server: a static bearer token, or an OAuth 2.1 (PKCE) token set (decisions/27). CREDENTIAL — never synced. */
export type McpServerAuth = McpBearerAuth | McpOAuthAuth;

/** A server config as the rest of the app sees it — `auth`/`headers`, when present, have already been merged in from wherever the adapter keeps credentials. */
export interface McpServerConfig {
  id: string;
  name: string;
  /** The MCP endpoint URL (decisions/14: "addressed by URL"). */
  url: string;
  /** Discovery/calls skip a disabled server entirely — it contributes nothing to a merged tool list and its host permission is not requested. */
  enabled: boolean;
  transport: McpTransportPreference;
  auth?: McpServerAuth;
  /** Custom request headers sent on every call to this server (decisions/15). Values are CREDENTIALS, so the whole map is never synced. Header names `authorization`, `content-type` and `accept` (case-insensitive) are reserved by the client and never sent from here — see {@link validateServerHeaders}. */
  headers?: Record<string, string>;
}

/** The fields of an {@link McpServerConfig} that are NOT credentials — what may be listed, synced and reordered freely. */
export type McpServerConfigCore = Omit<McpServerConfig, "auth" | "headers">;

// ---------------------------------------------------------------------------
// Reserved headers (decisions/15) — a rule, not a storage concern, so the
// management UI can refuse a conflicting header visibly at edit time and the
// HTTP client can enforce the same rule again at request-build time from the
// same source.
// ---------------------------------------------------------------------------

/** Header names the client controls for correctness and never lets a custom header override (decisions/15). Compared case-insensitively. `authorization` is only actually reserved when the server has auth configured — see {@link validateServerHeaders}. */
export const CLIENT_CONTROLLED_HEADERS = ["content-type", "accept"] as const;

export interface McpHeaderValidationIssue {
  header: string;
  reason: string;
}

/**
 * Check a candidate custom-headers map for reserved-name conflicts
 * (decisions/15: "Reserved-header conflicts need to be refused visibly at
 * edit time rather than silently dropped at request time"). Pure and
 * synchronous so a management UI can call it on every keystroke; returns one
 * issue per offending header rather than stopping at the first.
 */
export function validateServerHeaders(
  headers: Record<string, string> | undefined,
  opts?: { hasAuthToken?: boolean },
): McpHeaderValidationIssue[] {
  if (!headers) return [];
  const issues: McpHeaderValidationIssue[] = [];
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if ((CLIENT_CONTROLLED_HEADERS as readonly string[]).includes(lower)) {
      issues.push({
        header: name,
        reason: `"${name}" is set automatically by the client and cannot be overridden.`,
      });
      continue;
    }
    if (lower === "authorization" && opts?.hasAuthToken) {
      issues.push({
        header: name,
        reason:
          'A bearer token is configured for this server, so "Authorization" is already set. Remove the token or this header.',
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * CRUD over the remote MCP servers a user has configured. Deliberately the
 * same shape as `ProviderRegistry` (src/domain/providers) — same list/get/
 * add/update/remove/reorder, same credentials-merged-on-read posture — with
 * one difference that is real rather than incidental: there is no per-chat
 * "selected server" the way there is a selected provider, so there is no
 * dangling-selection case to mirror.
 */
export interface McpServerRegistry {
  /** Every registered server, in display order, credentials merged in. */
  listServers(): Promise<McpServerConfig[]>;

  /** Only the enabled servers — the set discovery and the agent loop actually act on. */
  listEnabledServers(): Promise<McpServerConfig[]>;

  /** One server by id, credentials merged in. `undefined` if `id` isn't registered. */
  getServer(id: string): Promise<McpServerConfig | undefined>;

  /** Register a new server; assigns and returns its `id`. Defaults `enabled: true` and `transport: "auto"` when omitted, so a minimal `{name, url}` is enough. */
  addServer(
    input: Omit<McpServerConfig, "id" | "enabled" | "transport"> & {
      enabled?: boolean;
      transport?: McpTransportPreference;
    },
  ): Promise<McpServerConfig>;

  /** Patch an existing server. An explicit `undefined` `auth`/`headers` CLEARS that credential. Returns the merged config, or `undefined` if `id` isn't registered. */
  updateServer(
    id: string,
    patch: Partial<Omit<McpServerConfig, "id">>,
  ): Promise<McpServerConfig | undefined>;

  /** Remove a server and its credentials. */
  removeServer(id: string): Promise<void>;

  /** Reorder to match `orderedIds`. Any id it omits is DROPPED — reordering is not a way to delete, so pass every current id back. */
  reorderServers(orderedIds: string[]): Promise<void>;
}

/**
 * Persist a token set the OAuth adapter just refreshed (card 76).
 *
 * This exists so the transport stack does not write the config store from
 * inside itself — the layering inversion decisions/29 names by name. Before
 * card 76, `src/lib/mcp/oauth.ts` imported the registry directly and called
 * `updateServer`; now it takes THIS port and the composition root's wiring
 * supplies an implementation, so `src/infra/mcp` has no edge to
 * `src/infra/chrome-storage` at all (`adapters-do-not-import-adapters`).
 *
 * Deliberately one write-only method rather than a second full registry:
 * refreshing a token is the ONLY thing the transport is allowed to change
 * about a stored server, and a port that can do nothing else makes that
 * true by construction rather than by discipline.
 *
 * Rejects with `StorageError` (src/domain/storage) like every other storage
 * port — the OAuth adapter treats persistence as best-effort and maps a
 * rejection to "this refreshed token was used for this one call and not
 * kept", which is also the correct behaviour for an unsaved draft config
 * whose `serverId` is not registered at all.
 */
export interface McpAuthTokenStore {
  /** Store `auth` as the given server's credentials. A `serverId` that is not registered is a no-op, not an error. */
  saveAuth(serverId: string, auth: McpOAuthAuth): Promise<void>;
}

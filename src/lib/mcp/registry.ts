// The MCP server-config registry (decisions/14-backend-mcp-servers.md,
// decisions/15-custom-headers-are-credentials.md): CRUD over the list of
// remote MCP servers a user has configured. Deliberately mirrors the shape
// and storage split of src/lib/providers/registry.ts (decisions/10) closely
// — same sync/local split, same defensive-parse-on-read posture, same
// dangling-id non-problem (there is no per-tab "selected server" the way
// there's a selected provider, so there's no dangling-selection case to
// mirror there). src/lib/providers/registry.ts itself is off-limits to this
// card (owned by concurrent work), so nothing here imports from it — this is
// a parallel module, not an extension of it.
//
// Storage split (decisions/10's pattern, applied per decisions/15):
//   - Everything except the auth token and custom header VALUES lives in
//     `chrome.storage.sync` under `mcp:servers:list`.
//   - Each server's optional bearer `auth.token` lives in
//     `chrome.storage.local` under `mcp:auth:<id>`.
//   - Each server's custom `headers` map lives in `chrome.storage.local`
//     under `mcp:headers:<id>`, as a WHOLE map (not split key-by-key) — a
//     header's VALUE is a credential per decision 15, and keeping the whole
//     map together in local storage is the simplest way to guarantee no
//     value ever reaches `chrome.storage.sync`, at the cost of the header
//     *names* also not being sync'd (an accepted, more conservative
//     trade-off than decision 15 strictly requires).
//
// Both stores are unencrypted at rest (decisions/07, decisions/10) — stating
// that plainly next to the token/header fields is card 39's (management UI)
// job, not this module's.

import type { McpError } from "./types";

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

/** How a server's `initialize` handshake should be attempted. `"auto"` (the default) tries the modern Streamable HTTP transport first and falls back to the legacy HTTP+SSE transport per the spec's backwards-compatibility guidance (see client.ts) — the two explicit values exist so a user (or a future diagnostics UI) can pin one down when auto-detection guesses wrong. */
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
 * of it is meant to sync and a single local blob under `mcp:auth:<id>`
 * already gives it the same storage locality a bearer token gets. Built and
 * refreshed by src/lib/mcp/oauth.ts; this module only stores/reads it.
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

/** Optional auth for a server: a static bearer token, or an OAuth 2.1 (PKCE) token set (decisions/27). */
export type McpServerAuth = McpBearerAuth | McpOAuthAuth;

/** A server config as the rest of the app sees it — `auth`/`headers`, when present, have already been merged in from local storage. */
export interface McpServerConfig {
  id: string;
  name: string;
  /** The MCP endpoint URL (decisions/14: "addressed by URL"). */
  url: string;
  /** Discovery/calls skip a disabled server entirely — it contributes nothing to a merged tool list and its host permission is not requested. */
  enabled: boolean;
  transport: McpTransportPreference;
  auth?: McpServerAuth;
  /** Custom request headers sent on every call to this server (decisions/15). Values are credentials — see the module doc. Header names `authorization`, `content-type`, and `accept` (case-insensitive) are reserved by the client and never sent from here; see {@link validateServerHeaders}. */
  headers?: Record<string, string>;
}

/** What actually lives in `chrome.storage.sync` — never carries `auth` or `headers`. */
type StoredMcpServerConfig = Omit<McpServerConfig, "auth" | "headers">;

const SYNC_KEY_SERVERS = "mcp:servers:list";
const LOCAL_KEY_AUTH_PREFIX = "mcp:auth:";
const LOCAL_KEY_HEADERS_PREFIX = "mcp:headers:";

const TRANSPORT_PREFERENCES: readonly McpTransportPreference[] = [
  "auto",
  "streamable-http",
  "sse",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Defensive against corrupted/foreign-written storage: drop any entry that doesn't look like a server config rather than letting it crash a consumer downstream (mirrors src/lib/providers/registry.ts's `isStoredProviderConfig`). */
function isStoredMcpServerConfig(v: unknown): v is StoredMcpServerConfig {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.name === "string" &&
    typeof v.url === "string" &&
    typeof v.enabled === "boolean" &&
    typeof v.transport === "string" &&
    (TRANSPORT_PREFERENCES as readonly string[]).includes(v.transport)
  );
}

// ---------------------------------------------------------------------------
// Reserved headers (decisions/15) — exported so the management UI (card 39)
// can refuse a conflicting header visibly at edit time, and used defensively
// again at request-build time in client.ts as a safety net (never silently
// dropped at request time is the UX goal; the enforcement itself is
// defense-in-depth wherever a header map is turned into a fetch call).
// ---------------------------------------------------------------------------

/** Header names the client controls for correctness and never lets a custom header override (decisions/15). Compared case-insensitively. `authorization` is only actually reserved when the server has an `auth` token configured — see {@link validateServerHeaders}. */
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
// Low-level storage helpers
// ---------------------------------------------------------------------------

async function readStoredList(): Promise<StoredMcpServerConfig[]> {
  const stored = await chrome.storage.sync.get(SYNC_KEY_SERVERS);
  const value = stored[SYNC_KEY_SERVERS];
  return Array.isArray(value) ? value.filter(isStoredMcpServerConfig) : [];
}

async function writeStoredList(list: StoredMcpServerConfig[]): Promise<void> {
  await chrome.storage.sync.set({ [SYNC_KEY_SERVERS]: list });
}

function authStorageKey(id: string): string {
  return `${LOCAL_KEY_AUTH_PREFIX}${id}`;
}

function headersStorageKey(id: string): string {
  return `${LOCAL_KEY_HEADERS_PREFIX}${id}`;
}

function isAuthorizationServerMetadata(
  v: unknown,
): v is McpOAuthAuth["authorizationServer"] {
  return (
    isRecord(v) &&
    typeof v.issuer === "string" &&
    typeof v.authorizationEndpoint === "string" &&
    typeof v.tokenEndpoint === "string" &&
    (v.registrationEndpoint === undefined || typeof v.registrationEndpoint === "string") &&
    (v.scopesSupported === undefined ||
      (Array.isArray(v.scopesSupported) && v.scopesSupported.every((s) => typeof s === "string")))
  );
}

/** Validates one branch inline (rather than as its own type-predicate helper) because a plain `Record<string, unknown>` isn't structurally assignable to `McpBearerAuth`/`McpOAuthAuth` (both lack an index signature) — TS rejects a type predicate whose asserted type isn't assignable to its parameter's declared type. */
function isMcpServerAuth(v: unknown): v is McpServerAuth {
  if (!isRecord(v)) return false;
  if (v.type === "bearer") {
    return typeof v.token === "string" && v.token.length > 0;
  }
  if (v.type === "oauth") {
    return (
      typeof v.accessToken === "string" &&
      v.accessToken.length > 0 &&
      typeof v.clientId === "string" &&
      v.clientId.length > 0 &&
      isAuthorizationServerMetadata(v.authorizationServer) &&
      (v.refreshToken === undefined || typeof v.refreshToken === "string") &&
      (v.expiresAt === undefined || typeof v.expiresAt === "number") &&
      (v.scope === undefined || typeof v.scope === "string") &&
      (v.clientSecret === undefined || typeof v.clientSecret === "string") &&
      (v.resource === undefined || typeof v.resource === "string")
    );
  }
  return false;
}

/** Whether a stored/candidate auth value is "empty" and should be cleared rather than written — a bearer token with no text, or (defensively) anything that isn't a recognized shape at all. An oauth auth is never considered empty this way; clearing it is always an explicit `writeAuth(id, undefined)`. */
function isEmptyAuth(auth: McpServerAuth): boolean {
  return auth.type === "bearer" && auth.token.length === 0;
}

function isHeadersMap(v: unknown): v is Record<string, string> {
  return (
    isRecord(v) &&
    Object.entries(v).every(
      ([k, val]) => typeof k === "string" && typeof val === "string",
    )
  );
}

async function readAuth(id: string): Promise<McpServerAuth | undefined> {
  const key = authStorageKey(id);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  return isMcpServerAuth(value) ? value : undefined;
}

/** Write (or, given `undefined`, clear) a server's auth. Always local storage — never synced. */
async function writeAuth(id: string, auth: McpServerAuth | undefined): Promise<void> {
  const key = authStorageKey(id);
  if (auth === undefined || isEmptyAuth(auth)) {
    await chrome.storage.local.remove(key);
  } else {
    await chrome.storage.local.set({ [key]: auth });
  }
}

async function readHeaders(id: string): Promise<Record<string, string> | undefined> {
  const key = headersStorageKey(id);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  return isHeadersMap(value) && Object.keys(value).length > 0 ? value : undefined;
}

/** Write (or, given `undefined`/`{}`, clear) a server's custom headers. Always local storage — never synced (decisions/15). */
async function writeHeaders(
  id: string,
  headers: Record<string, string> | undefined,
): Promise<void> {
  const key = headersStorageKey(id);
  if (headers === undefined || Object.keys(headers).length === 0) {
    await chrome.storage.local.remove(key);
  } else {
    await chrome.storage.local.set({ [key]: headers });
  }
}

async function withCredentials(
  config: StoredMcpServerConfig,
): Promise<McpServerConfig> {
  const [auth, headers] = await Promise.all([
    readAuth(config.id),
    readHeaders(config.id),
  ]);
  return {
    ...config,
    ...(auth !== undefined ? { auth } : {}),
    ...(headers !== undefined ? { headers } : {}),
  };
}

function generateServerId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `mcp-server-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// CRUD — card 39 (management UI) owns the UI on top of these
// ---------------------------------------------------------------------------

/** List every registered server, in display order, with `auth`/`headers` (if any) merged in from local storage. */
export async function listServers(): Promise<McpServerConfig[]> {
  const stored = await readStoredList();
  return Promise.all(stored.map(withCredentials));
}

/** List only the enabled servers — the set discovery (client.ts's `discoverAllServerTools`) and the agent loop actually act on. */
export async function listEnabledServers(): Promise<McpServerConfig[]> {
  const servers = await listServers();
  return servers.filter((s) => s.enabled);
}

/** Look up one server by id, credentials merged in. `undefined` if `id` isn't registered. */
export async function getServer(id: string): Promise<McpServerConfig | undefined> {
  const stored = await readStoredList();
  const config = stored.find((c) => c.id === id);
  if (!config) return undefined;
  return withCredentials(config);
}

/** Register a new server. Assigns and returns its `id`. `auth`/`headers`, if given, are written to local storage only — they never enter the synced list. Defaults `enabled: true` and `transport: "auto"` when omitted, so a minimal `{ name, url }` is enough to add a server. */
export async function addServer(
  input: Omit<McpServerConfig, "id"> & { enabled?: boolean; transport?: McpTransportPreference },
): Promise<McpServerConfig> {
  const id = generateServerId();
  const { auth, headers, ...rest } = input;
  const stored = await readStoredList();
  const config: StoredMcpServerConfig = {
    ...rest,
    id,
    enabled: rest.enabled ?? true,
    transport: rest.transport ?? "auto",
  };
  await writeStoredList([...stored, config]);
  await Promise.all([writeAuth(id, auth), writeHeaders(id, headers)]);
  return withCredentials(config);
}

/**
 * Patch an existing server. `auth`/`headers` — including an explicit
 * `undefined` to clear either — are routed to local storage; every other
 * field updates the synced entry. Returns the merged config, or `undefined`
 * if `id` isn't registered.
 */
export async function updateServer(
  id: string,
  patch: Partial<Omit<McpServerConfig, "id">>,
): Promise<McpServerConfig | undefined> {
  const stored = await readStoredList();
  const index = stored.findIndex((c) => c.id === id);
  if (index === -1) return undefined;

  const { auth, headers, ...rest } = patch;
  const updated: StoredMcpServerConfig = { ...stored[index], ...rest };
  const next = [...stored];
  next[index] = updated;
  await writeStoredList(next);

  if ("auth" in patch) await writeAuth(id, auth);
  if ("headers" in patch) await writeHeaders(id, headers);

  return withCredentials(updated);
}

/** Remove a server, its auth token, and its custom headers. */
export async function removeServer(id: string): Promise<void> {
  const stored = await readStoredList();
  await writeStoredList(stored.filter((c) => c.id !== id));
  await Promise.all([writeAuth(id, undefined), writeHeaders(id, undefined)]);
}

/**
 * Reorder the server list to match `orderedIds`. `orderedIds` should be a
 * permutation of the current ids; any id it omits is dropped from the
 * stored list — reordering is not a way to delete, so callers should always
 * pass every current id back (mirrors src/lib/providers/registry.ts's
 * `reorderProviders`).
 */
export async function reorderServers(orderedIds: string[]): Promise<void> {
  const stored = await readStoredList();
  const byId = new Map(stored.map((c) => [c.id, c] as const));
  const reordered = orderedIds
    .map((id) => byId.get(id))
    .filter((c): c is StoredMcpServerConfig => c !== undefined);
  await writeStoredList(reordered);
}

// Re-exported for callers that want to report a storage-layer problem using
// the same named-error-kind vocabulary the transport uses, without importing
// client.ts just for the type.
export type { McpError };

// `chrome.storage` implementation of `McpServerRegistry` (src/domain/tools)
// — decisions/14-backend-mcp-servers.md,
// decisions/15-custom-headers-are-credentials.md.
//
// The twin of ./provider-registry.ts, and now literally so: both configure
// ./keyed-record-store.ts rather than each keeping its own copy of
// list/get/add/update/remove/reorder plus a hand-rolled sync/local split.
// What remains here is what is actually different about MCP servers — the
// auth blob's validation, the header MAP (providers use a `{key, value}`
// array), the `enabled`/`transport` defaults an add applies, and the
// enabled-only listing discovery acts on.
//
// The credential split, restated because it is the rule that must not
// regress: `mcp:servers:list` is `chrome.storage.sync`. `mcp:auth:<id>` and
// `mcp:headers:<id>` are `chrome.storage.local` and are the ONLY place
// either value is written. Keeping the whole header map together in local
// means the header NAMES don't sync either — an accepted, more conservative
// trade-off than decision 15 strictly requires, and the simplest way to
// guarantee no VALUE ever reaches sync.

import { fail, ok } from "../../domain/result";
import type {
  McpServerAuth,
  McpServerConfigCore,
  McpServerRegistry,
  McpOAuthAuth,
  McpTransportPreference,
} from "../../domain/tools";
import { isRecord, type StorageAreaGateway } from "./area";
import { createKeyedRecordStore, credentialPart } from "./keyed-record-store";

const SYNC_KEY_SERVERS = "mcp:servers:list";
const LOCAL_KEY_AUTH_PREFIX = "mcp:auth:";
const LOCAL_KEY_HEADERS_PREFIX = "mcp:headers:";

const TRANSPORT_PREFERENCES: readonly McpTransportPreference[] = ["auto", "streamable-http", "sse"];

/** The credential fields of an `McpServerConfig`, as the keyed-record store's `parts`. */
interface McpServerCredentials {
  auth?: McpServerAuth | undefined;
  headers?: Record<string, string> | undefined;
}

// TODO: clean-code - 0.2 - DRY: decodeServerCore follows the identical isRecord(v) && typeof v.id === "string" && v.id.length > 0 && ... defensive-cast pattern as provider-registry.ts's decodeProviderCore, and generateServerId below mirrors generateProviderId (same crypto.randomUUID + fallback, differing only in the prefix literal) — per-record-shape leftovers around keyed-record-store.ts's shared mechanic.
/** Defensive against corrupted/foreign-written storage: drop any entry that doesn't look like a server config rather than letting it crash a consumer downstream. */
function decodeServerCore(v: unknown): McpServerConfigCore | undefined {
  if (
    isRecord(v) &&
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.name === "string" &&
    typeof v.url === "string" &&
    typeof v.enabled === "boolean" &&
    typeof v.transport === "string" &&
    // CAST: `TRANSPORT_PREFERENCES` is a readonly tuple of the LITERAL
    // transport names, so `.includes` only accepts one of those literals and
    // rejects the plain `string` we have here — the very question being
    // asked. Widening the receiver (not the argument) is what keeps the
    // check honest: an unknown transport still answers `false`.
    (TRANSPORT_PREFERENCES as readonly string[]).includes(v.transport)
  ) {
    // CAST: the `if` above IS the decode — every field of
    // `McpServerConfigCore` has just been checked on a value that came out of
    // `chrome.storage` as `unknown`. TypeScript does not turn an inline
    // conjunction into a whole-object narrowing, so the assertion states what
    // the condition proved; `unknown` is stepped through because
    // `Record<string, unknown>` and the config type do not overlap directly.
    return v as unknown as McpServerConfigCore;
  }
  return undefined;
}

function isAuthorizationServerMetadata(v: unknown): v is McpOAuthAuth["authorizationServer"] {
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

function isHeadersMap(v: unknown): v is Record<string, string> {
  return (
    isRecord(v) &&
    Object.entries(v).every(([k, val]) => typeof k === "string" && typeof val === "string")
  );
}

function generateServerId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `mcp-server-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createChromeStorageMcpServerRegistry(
  sync: StorageAreaGateway,
  local: StorageAreaGateway,
): McpServerRegistry {
  const records = createKeyedRecordStore<McpServerConfigCore, McpServerCredentials>({
    listKey: SYNC_KEY_SERVERS,
    listArea: sync,
    partArea: local,
    decodeCore: decodeServerCore,
    generateId: generateServerId,
    parts: {
      auth: credentialPart<McpServerAuth>({
        keyPrefix: LOCAL_KEY_AUTH_PREFIX,
        decode: (raw) => (isMcpServerAuth(raw) ? raw : undefined),
        // A bearer token with no text is nothing to store. An OAuth blob is
        // never "empty" this way — clearing one is always an explicit
        // `{auth: undefined}` patch, so a refresh that lands a token set
        // with, say, no refresh token can't silently delete the sign-in.
        isEmpty: (auth) => auth.type === "bearer" && auth.token.length === 0,
      }),
      headers: credentialPart<Record<string, string>>({
        keyPrefix: LOCAL_KEY_HEADERS_PREFIX,
        decode: (raw) => (isHeadersMap(raw) && Object.keys(raw).length > 0 ? raw : undefined),
        isEmpty: (value) => Object.keys(value).length === 0,
      }),
    },
  });

  return {
    listServers: () => records.list(),

    async listEnabledServers() {
      const [servers, err] = await records.list();
      if (err) return fail(err);
      return ok(servers.filter((s) => s.enabled));
    },

    getServer: (id) => records.get(id),

    addServer(input) {
      // MCP-specific, and deliberately not a hook on the generic store: a
      // provider has no equivalent defaultable field, and "what a missing
      // field means" is exactly the kind of per-record knowledge a shared
      // mechanic should not be carrying.
      return records.add({
        ...input,
        enabled: input.enabled ?? true,
        transport: input.transport ?? "auto",
      });
    },

    updateServer: (id, patch) => records.update(id, patch),
    removeServer: (id) => records.remove(id),
    reorderServers: (orderedIds) => records.reorder(orderedIds),
  } satisfies McpServerRegistry;
}

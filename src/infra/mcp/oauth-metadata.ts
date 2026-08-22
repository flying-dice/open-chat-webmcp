// Authorization-server DISCOVERY and dynamic client REGISTRATION — the two
// steps that happen before anyone signs in (card 76; moved unchanged from
// src/lib/mcp/oauth.ts).
//
// RFCs implemented here, and where:
//   - RFC 9728 (OAuth 2.0 Protected Resource Metadata): `discoverAuthorizationServer`
//     GETs `/.well-known/oauth-protected-resource` for the MCP server's URL,
//     reading `authorization_servers` for the issuer to use.
//   - RFC 8414 (OAuth 2.0 Authorization Server Metadata): the same function
//     GETs `/.well-known/oauth-authorization-server` for the resolved issuer
//     (falling back to the MCP server's own origin as the issuer candidate
//     when no RFC 9728 document was found) for `issuer`/
//     `authorization_endpoint`/`token_endpoint`/`registration_endpoint`.
//     Both lookups use `wellKnownCandidates`, below: per RFC 9728 §3.1 / RFC
//     8414 §3.1, when the resource/issuer URL has a path component the
//     well-known segment is inserted BEFORE that path (tried first), with
//     the bare-origin form as a fallback (tried second) for a server that
//     only implements the simpler convention. Both forms occur in the wild —
//     e.g. GitHub's MCP server (`api.githubcopilot.com/mcp`) only answers at
//     the path-inserted `/.well-known/oauth-protected-resource/mcp`, and its
//     issuer `github.com/login/oauth` only answers at the path-inserted
//     `/.well-known/oauth-authorization-server/login/oauth` — a bare-origin-only
//     first attempt at this discovery chain was verified 404ing against a real
//     server before this was fixed.
//   - RFC 7591 (OAuth 2.0 Dynamic Client Registration): `registerClient` POSTs
//     a public-client registration (`token_endpoint_auth_method: "none"`,
//     `grant_types: ["authorization_code", "refresh_token"]`) to the
//     discovered `registration_endpoint`.
//
// Both functions are stateless and touch no `chrome.*` API, so they are
// exported as plain functions and also bound into the `McpOAuthClient` object
// ./oauth.ts builds.

import type {
  McpAuthorizationServerInfo,
  McpDynamicClientRegistration,
  McpError,
  McpResult,
} from "../../domain/tools";
import { isRecord } from "./json-rpc";
import { classifyFetchError, fetchJson } from "./oauth-http";
import { OAUTH_REQUEST_TIMEOUT_MS } from "./timeouts";

/**
 * Both RFC 9728 §3.1 and RFC 8414 §3.1 locate a resource/issuer's metadata
 * document by INSERTING the well-known segment before the URL's path
 * component when it has one (e.g. issuer `https://github.com/login/oauth` ->
 * `https://github.com/.well-known/oauth-authorization-server/login/oauth`),
 * falling back to the bare-origin form only for a path-less URL or a server
 * that doesn't implement path insertion. Returns candidates in that priority
 * order — path-inserted first, bare-origin second — deduplicated when the
 * URL has no path (both forms would otherwise coincide).
 */
function wellKnownCandidates(baseUrl: string, wellKnownName: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return [];
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  const bareOrigin = `${parsed.origin}/.well-known/${wellKnownName}`;
  return path.length > 0
    ? [`${parsed.origin}/.well-known/${wellKnownName}${path}`, bareOrigin]
    : [bareOrigin];
}

/** Try each candidate URL in order, returning the first that resolves; if none do, the last (most-generic) candidate's error, since that's the most standard location a server that implements this metadata at all would use. */
async function fetchFirstOk(urls: string[]): Promise<McpResult<unknown>> {
  let lastError: McpError = {
    kind: "not-mcp-endpoint",
    message: "No well-known metadata URL could be constructed.",
  };
  for (const url of urls) {
    const result = await fetchJson(url);
    if (result.ok) return result;
    lastError = result.error;
  }
  return { ok: false, error: lastError };
}

function parseScopes(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const scopes = v.filter((s): s is string => typeof s === "string" && s.length > 0);
  return scopes.length > 0 ? scopes : undefined;
}

/**
 * Resolve the authorization server for an MCP server's URL, per
 * decisions/27: try RFC 9728's protected-resource document — at the
 * path-inserted location first, then the MCP server's bare origin — reading
 * its `authorization_servers` list for the issuer to use; if neither
 * location has the document, or it names no authorization server, fall back
 * to treating the MCP server's own origin as the issuer directly. Either
 * way, the actual metadata comes from RFC 8414's
 * `/.well-known/oauth-authorization-server`, tried at the resolved issuer's
 * path-inserted location first, then its bare origin.
 */
export async function discoverAuthorizationServer(
  mcpServerUrl: string,
): Promise<McpResult<McpAuthorizationServerInfo>> {
  let origin: string;
  try {
    origin = new URL(mcpServerUrl).origin;
  } catch {
    return {
      ok: false,
      error: { kind: "not-mcp-endpoint", message: `"${mcpServerUrl}" is not a valid URL.` },
    };
  }

  let issuerCandidate = origin;
  // RFC 9728's `scopes_supported`, when present, is what THIS resource says
  // its own tools need — a more specific answer than an authorization
  // server's own `scopes_supported` (RFC 8414's, checked below only as a
  // fallback), which just lists what the AS is capable of issuing across
  // every resource it serves. Missing this was the original bug: without a
  // `scope` in the authorization request, GitHub (and most authorization
  // servers) issue a token with no meaningful grants, so every MCP tool call
  // then fails as a permission error even though sign-in itself succeeds.
  let resourceScopes: string[] | undefined;
  const protectedResource = await fetchFirstOk(
    wellKnownCandidates(mcpServerUrl, "oauth-protected-resource"),
  );
  if (protectedResource.ok) {
    const body = protectedResource.value;
    const servers =
      isRecord(body) && Array.isArray(body.authorization_servers)
        ? body.authorization_servers.filter(
            (s): s is string => typeof s === "string" && s.length > 0,
          )
        : [];
    if (servers.length > 0) issuerCandidate = servers[0];
    if (isRecord(body)) resourceScopes = parseScopes(body.scopes_supported);
  }
  // else: no RFC 9728 document at either location (common for servers that
  // only implement RFC 8414 directly, without the separate protected-resource
  // indirection) — issuerCandidate stays the MCP server's own origin, the
  // documented fallback.

  const metadataUrls = wellKnownCandidates(issuerCandidate, "oauth-authorization-server");
  const metadata = await fetchFirstOk(metadataUrls);
  if (!metadata.ok) return metadata;

  const body = metadata.value;
  if (
    !isRecord(body) ||
    typeof body.issuer !== "string" ||
    typeof body.authorization_endpoint !== "string" ||
    typeof body.token_endpoint !== "string"
  ) {
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        message: `${metadataUrls[0]} did not return valid RFC 8414 metadata (missing issuer/authorization_endpoint/token_endpoint).`,
      },
    };
  }

  return {
    ok: true,
    value: {
      issuer: body.issuer,
      authorizationEndpoint: body.authorization_endpoint,
      tokenEndpoint: body.token_endpoint,
      registrationEndpoint:
        typeof body.registration_endpoint === "string" ? body.registration_endpoint : undefined,
      scopesSupported: resourceScopes ?? parseScopes(body.scopes_supported),
    },
  };
}

/**
 * Register this extension as a public OAuth client at `registrationEndpoint`
 * (RFC 7591). Always `token_endpoint_auth_method: "none"` — this extension
 * has nowhere safe to keep a client secret, so it is never a confidential
 * client, per decisions/27. A server MAY hand back a `client_secret` anyway
 * (some do, harmlessly); it's carried through to the caller and stored
 * alongside `clientId` if so, but never required.
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
): Promise<McpResult<McpDynamicClientRegistration>> {
  let response: Response;
  try {
    response = await fetch(registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
      signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: classifyFetchError(err) };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        message: `Dynamic client registration at ${registrationEndpoint} failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}.`,
      },
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        message: `Registration response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
  if (!isRecord(json) || typeof json.client_id !== "string" || json.client_id.length === 0) {
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        message: `${registrationEndpoint} did not return a client_id.`,
      },
    };
  }

  return {
    ok: true,
    value: {
      clientId: json.client_id,
      clientSecret: typeof json.client_secret === "string" ? json.client_secret : undefined,
    },
  };
}

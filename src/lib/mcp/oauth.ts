// OAuth 2.1 (PKCE) as a second auth mode for HTTP MCP servers
// (decisions/27-oauth-for-http-mcp-servers.md), alongside the static bearer
// token client.ts's `authHeader` already handles. Several production remote
// MCP servers (Linear, Notion, Sentry, and others) require the
// authorization-code flow the MCP spec (2025-06-18) describes for HTTP
// transports rather than a static token to paste — this module is the whole
// discovery -> registration -> authorize -> refresh chain for that flow,
// scoped exactly to what decisions/27 calls for and no further (manual
// client_id/secret entry and WWW-Authenticate-challenge discovery are
// explicitly out of scope there).
//
// RFCs implemented, and where:
//   - RFC 9728 (OAuth 2.0 Protected Resource Metadata): `discoverAuthorizationServer`
//     GETs `/.well-known/oauth-protected-resource` for the MCP server's URL,
//     reading `authorization_servers` for the issuer to use.
//   - RFC 8414 (OAuth 2.0 Authorization Server Metadata): `discoverAuthorizationServer`
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
//   - RFC 6749 §4.1 + §6 (Authorization Code Grant, Refreshing an Access
//     Token): `runAuthorizationFlow` drives the redirect and the initial code
//     exchange; `getValidAuth` drives the `refresh_token` grant.
//   - RFC 7636 (PKCE): `runAuthorizationFlow` generates an S256
//     verifier/challenge pair and sends `code_verifier` on the token
//     exchange — required because this extension is a public client with no
//     client secret to prove its identity otherwise.
//   - RFC 8707 (Resource Indicators): every authorization and token request
//     this module makes carries `resource` set to the MCP server's own URL,
//     the spec's mitigation against a token issued for one resource being
//     replayed against another.
//
// Never-throw discipline (mirrors client.ts and registry.ts): every exported
// function returns an `McpResult`, never throws.
//
// This module depends on registry.ts (for `McpServerConfig`/`McpOAuthAuth`
// and to persist a refreshed token via `updateServer`) but is never imported
// BY registry.ts — client.ts is the only consumer, calling `getValidAuth`
// from its `connect()` (see client.ts's `resolveAuthHeader`), and card 63's
// management UI will call `discoverAuthorizationServer`/`registerClient`/
// `runAuthorizationFlow` directly from a click handler to drive the sign-in
// flow. No cycle: types.ts <- registry.ts <- oauth.ts <- client.ts.

import { updateServer } from "./registry";
import type { McpOAuthAuth, McpServerConfig } from "./registry";
import type { McpError, McpResult } from "../../domain/tools";

// ---------------------------------------------------------------------------
// Small internal utilities
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Budget for a single discovery/registration/token request. Deliberately not
 * imported from client.ts's DEFAULT_CONNECT_TIMEOUT_MS — importing from
 * client.ts here would create the exact import cycle the module doc above
 * says doesn't exist (client.ts imports this module, not the reverse), so
 * this gets its own copy of the same 10s number instead.
 */
const OAUTH_REQUEST_TIMEOUT_MS = 10_000;

function classifyFetchError(err: unknown): McpError {
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return { kind: "timeout", message: `Timed out after ${OAUTH_REQUEST_TIMEOUT_MS}ms during OAuth discovery/token exchange.` };
  }
  if (err instanceof TypeError) {
    return {
      kind: "unreachable",
      message:
        "Could not reach the authorization server. Either the host is down, or this extension hasn't been granted permission to talk to it yet.",
    };
  }
  return { kind: "invalid-response", message: err instanceof Error ? err.message : String(err) };
}

/** GET `url` and parse the body as JSON. Used for the two well-known metadata documents — never a POST, never form-encoded. */
async function fetchJson(url: string): Promise<McpResult<unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS) });
  } catch (err) {
    return { ok: false, error: classifyFetchError(err) };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: { kind: "not-mcp-endpoint", message: `${url} responded ${response.status} ${response.statusText}.` },
    };
  }
  try {
    return { ok: true, value: await response.json() };
  } catch (err) {
    return {
      ok: false,
      error: { kind: "invalid-response", message: `${url} did not return valid JSON: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
}

/** POST `application/x-www-form-urlencoded` `body` to a token endpoint and parse the JSON response, classifying a non-2xx per RFC 6749 §5.2's standard `error`/`error_description` shape as `kind: "auth"` (the same kind an expired bearer token produces) rather than the generic HTTP-failure kinds `fetchJson` uses for metadata GETs. */
async function postToken(tokenEndpoint: string, body: URLSearchParams): Promise<McpResult<unknown>> {
  let response: Response;
  try {
    response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
      signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: classifyFetchError(err) };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }

  if (!response.ok) {
    const errCode = isRecord(json) && typeof json.error === "string" ? json.error : undefined;
    const description = isRecord(json) && typeof json.error_description === "string" ? json.error_description : undefined;
    return {
      ok: false,
      error: {
        kind: "auth",
        status: response.status,
        message:
          description ??
          (errCode ? `Token request failed: ${errCode}` : `Token endpoint responded ${response.status} ${response.statusText}.`),
      },
    };
  }
  if (json === undefined) {
    return { ok: false, error: { kind: "invalid-response", message: "Token endpoint did not return valid JSON." } };
  }
  return { ok: true, value: json };
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636)
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomUrlSafeString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** A fresh S256 PKCE verifier/challenge pair (RFC 7636 §4.1-4.2). 32 random bytes base64url-encode to a 43-character verifier, within the spec's required 43-128 character range. */
async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomUrlSafeString(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) };
}

// ---------------------------------------------------------------------------
// RFC 9728 + RFC 8414 — authorization server discovery
// ---------------------------------------------------------------------------

/** The authorization-server metadata this module (and `McpOAuthAuth.authorizationServer` in registry.ts) deals in — a deliberate subset of RFC 8414's full metadata document, just the three endpoints the rest of this flow needs. */
export type McpAuthorizationServerInfo = McpOAuthAuth["authorizationServer"];

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
  return path.length > 0 ? [`${parsed.origin}/.well-known/${wellKnownName}${path}`, bareOrigin] : [bareOrigin];
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
    return { ok: false, error: { kind: "not-mcp-endpoint", message: `"${mcpServerUrl}" is not a valid URL.` } };
  }

  function parseScopes(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const scopes = v.filter((s): s is string => typeof s === "string" && s.length > 0);
    return scopes.length > 0 ? scopes : undefined;
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
        ? body.authorization_servers.filter((s): s is string => typeof s === "string" && s.length > 0)
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
      registrationEndpoint: typeof body.registration_endpoint === "string" ? body.registration_endpoint : undefined,
      scopesSupported: resourceScopes ?? parseScopes(body.scopes_supported),
    },
  };
}

// ---------------------------------------------------------------------------
// RFC 7591 — dynamic client registration
// ---------------------------------------------------------------------------

export interface McpDynamicClientRegistration {
  clientId: string;
  clientSecret?: string;
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
      error: { kind: "invalid-response", message: `Registration response was not valid JSON: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
  if (!isRecord(json) || typeof json.client_id !== "string" || json.client_id.length === 0) {
    return { ok: false, error: { kind: "invalid-response", message: `${registrationEndpoint} did not return a client_id.` } };
  }

  return {
    ok: true,
    value: {
      clientId: json.client_id,
      clientSecret: typeof json.client_secret === "string" ? json.client_secret : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// RFC 6749 §4.1 + RFC 7636 + RFC 8707 — authorization-code + PKCE flow
// ---------------------------------------------------------------------------

export interface McpOAuthFlowConfig {
  /** The MCP server's own URL — sent as the RFC 8707 `resource` parameter on both the authorization and token requests, and stored on the resulting auth so `getValidAuth` can resend it on refresh. */
  serverUrl: string;
  clientId: string;
  clientSecret?: string;
  /** Space-separated scopes to request, if known ahead of time (e.g. from server docs). Omitted asks for whatever the authorization server defaults to. */
  scope?: string;
}

function parseTokenResponse(
  raw: unknown,
  config: Pick<McpOAuthFlowConfig, "clientId" | "clientSecret" | "serverUrl" | "scope">,
  authorizationServer: McpAuthorizationServerInfo,
): McpResult<McpOAuthAuth> {
  if (!isRecord(raw) || typeof raw.access_token !== "string" || raw.access_token.length === 0) {
    return { ok: false, error: { kind: "invalid-response", message: "Token endpoint did not return an access_token." } };
  }
  const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
  return {
    ok: true,
    value: {
      type: "oauth",
      accessToken: raw.access_token,
      refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
      expiresAt: expiresIn !== undefined ? Date.now() + expiresIn * 1000 : undefined,
      scope: typeof raw.scope === "string" ? raw.scope : config.scope,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      authorizationServer,
      resource: config.serverUrl,
    },
  };
}

async function exchangeCodeForToken(
  config: McpOAuthFlowConfig,
  discovery: McpAuthorizationServerInfo,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<McpResult<McpOAuthAuth>> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
    resource: config.serverUrl, // RFC 8707 — repeated on the token request, not just the authorization request.
  });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);

  const result = await postToken(discovery.tokenEndpoint, body);
  if (!result.ok) return result;
  return parseTokenResponse(result.value, config, discovery);
}

/**
 * Drive the interactive authorization-code + PKCE flow end to end: build the
 * authorization URL (with a fresh S256 challenge, `state`, and the RFC 8707
 * `resource` parameter), open it via `chrome.identity.launchWebAuthFlow`,
 * validate the redirect (`state` match, no `error`), and exchange the
 * returned `code` at `token_endpoint` for the full oauth `McpServerAuth`
 * object. This is the one function card 63's management UI calls directly
 * from a click handler — `chrome.identity.launchWebAuthFlow` requires an
 * active user gesture, so nothing here should be awaited by a caller before
 * this function's own first `await`.
 */
export async function runAuthorizationFlow(
  config: McpOAuthFlowConfig,
  discovery: McpAuthorizationServerInfo,
): Promise<McpResult<McpOAuthAuth>> {
  if (typeof chrome === "undefined" || !chrome.identity) {
    return { ok: false, error: { kind: "invalid-response", message: "chrome.identity is unavailable in this context." } };
  }

  const redirectUri = chrome.identity.getRedirectURL();
  const { verifier, challenge } = await generatePkce();
  const state = randomUrlSafeString(16);

  const authUrl = new URL(discovery.authorizationEndpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("resource", config.serverUrl); // RFC 8707
  if (config.scope) authUrl.searchParams.set("scope", config.scope);

  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "auth",
        message: err instanceof Error ? err.message : "The sign-in window was closed or the user denied access.",
      },
    };
  }
  if (!responseUrl) {
    return { ok: false, error: { kind: "auth", message: "Sign-in did not complete." } };
  }

  let redirected: URL;
  try {
    redirected = new URL(responseUrl);
  } catch {
    return { ok: false, error: { kind: "invalid-response", message: "The authorization redirect was not a valid URL." } };
  }

  const oauthError = redirected.searchParams.get("error");
  if (oauthError) {
    return {
      ok: false,
      error: { kind: "auth", message: redirected.searchParams.get("error_description") ?? oauthError },
    };
  }
  if (redirected.searchParams.get("state") !== state) {
    return { ok: false, error: { kind: "auth", message: "Authorization response state did not match the request — aborting." } };
  }
  const code = redirected.searchParams.get("code");
  if (!code) {
    return { ok: false, error: { kind: "invalid-response", message: "Authorization redirect had no code parameter." } };
  }

  return exchangeCodeForToken(config, discovery, code, verifier, redirectUri);
}

// ---------------------------------------------------------------------------
// RFC 6749 §6 — refreshing an access token
// ---------------------------------------------------------------------------

/** How far ahead of the real `expiresAt` a token is treated as due for refresh — cheap insurance against a token expiring mid-request. */
const EXPIRY_SKEW_MS = 60_000;

function parseRefreshedToken(raw: unknown, previous: McpOAuthAuth): McpResult<McpOAuthAuth> {
  if (!isRecord(raw) || typeof raw.access_token !== "string" || raw.access_token.length === 0) {
    return { ok: false, error: { kind: "invalid-response", message: "Refresh response did not include an access_token." } };
  }
  const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
  return {
    ok: true,
    value: {
      ...previous,
      accessToken: raw.access_token,
      // RFC 6749 §6: the server MAY issue a new refresh token; if it
      // doesn't, the existing one remains valid and must be kept.
      refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : previous.refreshToken,
      expiresAt: expiresIn !== undefined ? Date.now() + expiresIn * 1000 : undefined,
      scope: typeof raw.scope === "string" ? raw.scope : previous.scope,
    },
  };
}

/**
 * Return a currently-valid oauth auth for `config`, refreshing it first if
 * needed. Unchanged and returned immediately if `expiresAt` is unset (unknown
 * expiry — treated as valid until a 401 says otherwise) or still comfortably
 * (>{@link EXPIRY_SKEW_MS}) in the future. Otherwise refreshes via the
 * `refresh_token` grant at `authorizationServer.tokenEndpoint`, persisting
 * the refreshed tokens back through registry.ts's `updateServer`.
 *
 * Persistence is best-effort: `config.id` may be an unsaved draft (e.g.
 * `"draft"`, the literal id the options form's test-connection path uses
 * before a server is ever registered — see McpServerForm.svelte) that
 * `updateServer` can't find, in which case it resolves `undefined` and this
 * function simply returns the refreshed token for this one call without
 * durably storing it — that's the correct behavior for a draft under test,
 * not an error.
 *
 * A missing refresh token, or the refresh grant itself failing (e.g.
 * `invalid_grant` for a revoked/expired refresh token), surfaces as
 * `kind: "auth"` — the same kind an expired bearer token produces, so
 * nothing downstream needs a new error kind to handle "reconnect needed".
 */
export async function getValidAuth(config: McpServerConfig): Promise<McpResult<McpOAuthAuth>> {
  const auth = config.auth;
  if (!auth || auth.type !== "oauth") {
    return {
      ok: false,
      error: { kind: "auth", message: `Server "${config.name}" has no OAuth credentials configured.` },
    };
  }

  const stillValid = auth.expiresAt === undefined || auth.expiresAt - EXPIRY_SKEW_MS > Date.now();
  if (stillValid) return { ok: true, value: auth };

  if (!auth.refreshToken) {
    return {
      ok: false,
      error: {
        kind: "auth",
        message: `Access token for "${config.name}" has expired and no refresh token is available — sign in again.`,
      },
    };
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: auth.refreshToken,
    client_id: auth.clientId,
    resource: auth.resource ?? config.url, // RFC 8707 — re-sent on refresh for the same reason it's sent on the original request.
  });
  if (auth.clientSecret) body.set("client_secret", auth.clientSecret);

  const refreshed = await postToken(auth.authorizationServer.tokenEndpoint, body);
  if (!refreshed.ok) return refreshed;

  const parsed = parseRefreshedToken(refreshed.value, auth);
  if (!parsed.ok) return parsed;

  await updateServer(config.id, { auth: parsed.value });

  return parsed;
}

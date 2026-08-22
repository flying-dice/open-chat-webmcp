// `McpOAuthClient` (src/domain/tools) — OAuth 2.1 + PKCE as a second auth
// mode for HTTP MCP servers (decisions/27-oauth-for-http-mcp-servers.md),
// alongside the static bearer token ./headers.ts already handles. Several
// production remote MCP servers (Linear, Notion, Sentry, and others) require
// the authorization-code flow the MCP spec (2025-06-18) describes for HTTP
// transports rather than a static token to paste.
//
// RFCs implemented HERE (discovery and registration are ./oauth-metadata.ts):
//   - RFC 6749 §4.1 + §6 (Authorization Code Grant, Refreshing an Access
//     Token): `runAuthorizationFlow` drives the redirect and the initial code
//     exchange; `getValidAuth` drives the `refresh_token` grant.
//   - RFC 7636 (PKCE): `runAuthorizationFlow` generates an S256
//     verifier/challenge pair and sends `code_verifier` on the token
//     exchange — required because this extension is a public client with no
//     client secret to prove its identity otherwise.
//   - RFC 8707 (Resource Indicators): every authorization and token request
//     carries `resource` set to the MCP server's own URL, the spec's
//     mitigation against a token issued for one resource being replayed
//     against another.
//
// Never-throw discipline (mirrors ./gateway.ts): every method returns an
// `McpResult`, never throws.
//
// CARD 76 DISSOLVED THE INVERSION decisions/29 named here. This module used
// to `import { mcpServerRegistry }` and call `updateServer` to persist a
// refreshed token — the transport stack writing the config store from inside
// itself, and an adapter importing another adapter. It now takes an
// `McpAuthTokenStore` (src/domain/tools) at construction, so the write goes
// out through a port the composition root's wiring supplies and
// `src/infra/mcp` has no edge into `src/infra/chrome-storage` at all.
//
// `chrome.identity` lives here and only here in this adapter: the interactive
// flow needs `launchWebAuthFlow`, and `getRedirectURL` names the redirect the
// authorization server sends the user back to.

import type {
  McpAuthorizationServerInfo,
  McpAuthTokenStore,
  McpOAuthAuth,
  McpOAuthClient,
  McpOAuthFlowConfig,
  McpResult,
  McpServerConfig,
} from "../../domain/tools";
import { isRecord } from "./json-rpc";
import { postToken } from "./oauth-http";
import { discoverAuthorizationServer, registerClient } from "./oauth-metadata";

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
// Token responses
// ---------------------------------------------------------------------------

function parseTokenResponse(
  raw: unknown,
  config: Pick<McpOAuthFlowConfig, "clientId" | "clientSecret" | "serverUrl" | "scope">,
  authorizationServer: McpAuthorizationServerInfo,
): McpResult<McpOAuthAuth> {
  if (!isRecord(raw) || typeof raw.access_token !== "string" || raw.access_token.length === 0) {
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        message: "Token endpoint did not return an access_token.",
      },
    };
  }
  const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
  const refreshToken = typeof raw.refresh_token === "string" ? raw.refresh_token : undefined;
  const expiresAt = expiresIn !== undefined ? Date.now() + expiresIn * 1000 : undefined;
  const scope = typeof raw.scope === "string" ? raw.scope : config.scope;
  // `McpOAuthAuth`'s `refreshToken`/`expiresAt`/`scope`/`clientSecret`
  // (src/domain/tools, not this folder's to widen) are optional without
  // `| undefined` — conditional spread so an absent value omits the key
  // instead of assigning it `undefined`.
  return {
    ok: true,
    value: {
      type: "oauth",
      accessToken: raw.access_token,
      ...(refreshToken !== undefined && { refreshToken }),
      ...(expiresAt !== undefined && { expiresAt }),
      ...(scope !== undefined && { scope }),
      clientId: config.clientId,
      ...(config.clientSecret !== undefined && { clientSecret: config.clientSecret }),
      authorizationServer,
      resource: config.serverUrl,
    },
  };
}

function parseRefreshedToken(raw: unknown, previous: McpOAuthAuth): McpResult<McpOAuthAuth> {
  if (!isRecord(raw) || typeof raw.access_token !== "string" || raw.access_token.length === 0) {
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        message: "Refresh response did not include an access_token.",
      },
    };
  }
  const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
  // `McpOAuthAuth`'s optional fields (src/domain/tools, not this folder's to
  // widen) have no `| undefined` in their declared type, so this builds the
  // refreshed record by mutating a copy rather than assigning `undefined`
  // explicitly — `delete` is how `expiresAt` gets cleared below when the
  // response carries no `expires_in`, since a plain spread can't remove a
  // key `...previous` already set.
  const refreshed: McpOAuthAuth = { ...previous, accessToken: raw.access_token };
  // RFC 6749 §6: the server MAY issue a new refresh token; if it
  // doesn't, the existing one remains valid and must be kept.
  if (typeof raw.refresh_token === "string") refreshed.refreshToken = raw.refresh_token;
  if (expiresIn !== undefined) {
    refreshed.expiresAt = Date.now() + expiresIn * 1000;
  } else {
    delete refreshed.expiresAt;
  }
  if (typeof raw.scope === "string") refreshed.scope = raw.scope;
  return { ok: true, value: refreshed };
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
 * returned `code` at `token_endpoint` for the full oauth auth object. This is
 * the one operation the options page calls directly from a click handler —
 * `chrome.identity.launchWebAuthFlow` requires an active user gesture, so
 * nothing should be awaited by a caller before this function's own first
 * `await`.
 */
async function runAuthorizationFlow(
  config: McpOAuthFlowConfig,
  discovery: McpAuthorizationServerInfo,
): Promise<McpResult<McpOAuthAuth>> {
  if (typeof chrome === "undefined" || !chrome.identity) {
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        message: "chrome.identity is unavailable in this context.",
      },
    };
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
    responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "auth",
        message:
          err instanceof Error
            ? err.message
            : "The sign-in window was closed or the user denied access.",
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
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        message: "The authorization redirect was not a valid URL.",
      },
    };
  }

  const oauthError = redirected.searchParams.get("error");
  if (oauthError) {
    return {
      ok: false,
      error: {
        kind: "auth",
        message: redirected.searchParams.get("error_description") ?? oauthError,
      },
    };
  }
  if (redirected.searchParams.get("state") !== state) {
    return {
      ok: false,
      error: {
        kind: "auth",
        message: "Authorization response state did not match the request — aborting.",
      },
    };
  }
  const code = redirected.searchParams.get("code");
  if (!code) {
    return {
      ok: false,
      error: { kind: "invalid-response", message: "Authorization redirect had no code parameter." },
    };
  }

  return exchangeCodeForToken(config, discovery, code, verifier, redirectUri);
}

// ---------------------------------------------------------------------------
// RFC 6749 §6 — refreshing an access token
// ---------------------------------------------------------------------------

/** How far ahead of the real `expiresAt` a token is treated as due for refresh — cheap insurance against a token expiring mid-request. */
const EXPIRY_SKEW_MS = 60_000;

export interface McpOAuthClientOptions {
  /** Where a refreshed token set is persisted (src/domain/tools). Injected rather than imported: this adapter must not reach into src/infra/chrome-storage — see the module doc. */
  tokenStore: McpAuthTokenStore;
}

/**
 * Build the `McpOAuthClient` a runtime surface uses. Stateless apart from the
 * injected token store, so the same instance can back both the sign-in UI and
 * the gateway's `McpTokenResolver`.
 */
export function createMcpOAuthClient(options: McpOAuthClientOptions): McpOAuthClient {
  /**
   * Return a currently-valid oauth auth for `config`, refreshing it first if
   * needed. Unchanged and returned immediately if `expiresAt` is unset
   * (unknown expiry — treated as valid until a 401 says otherwise) or still
   * comfortably (>{@link EXPIRY_SKEW_MS}) in the future. Otherwise refreshes
   * via the `refresh_token` grant at `authorizationServer.tokenEndpoint`,
   * persisting the refreshed tokens through the injected
   * `McpAuthTokenStore`.
   *
   * Persistence is BEST-EFFORT, and deliberately so: `config.id` may be an
   * unsaved draft (e.g. `"draft"`, the literal id the options form's
   * test-connection path uses before a server is ever registered — see
   * McpServerForm.svelte) that the store can't find, in which case the
   * refreshed token is simply used for this one call without being durably
   * stored. That is the correct behaviour for a draft under test, not an
   * error — and by the same token a storage failure must not turn a
   * successful refresh into a failed request, so a rejection from the store
   * is swallowed here rather than surfaced.
   */
  async function getValidAuth(config: McpServerConfig): Promise<McpResult<McpOAuthAuth>> {
    const auth = config.auth;
    if (auth?.type !== "oauth") {
      return {
        ok: false,
        error: {
          kind: "auth",
          message: `Server "${config.name}" has no OAuth credentials configured.`,
        },
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

    await options.tokenStore.saveAuth(config.id, parsed.value).catch(() => undefined);

    return parsed;
  }

  return {
    // Card 78: the same `getRedirectURL()` `runAuthorizationFlow` sends as
    // `redirect_uri`, exposed on the port so the options form's manual
    // app-registration panel shows the value the flow actually uses instead
    // of computing its own. Guarded the way `runAuthorizationFlow` guards
    // `launchWebAuthFlow`, so it never throws outside a browser-extension
    // context (a future test render, a bare Node import of the barrel).
    redirectUri: () =>
      typeof chrome !== "undefined" && chrome.identity ? chrome.identity.getRedirectURL() : "",
    discoverAuthorizationServer,
    registerClient,
    runAuthorizationFlow,
    getValidAuth,
  };
}

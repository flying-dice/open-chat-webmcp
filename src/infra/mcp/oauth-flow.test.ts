// Tests for `runAuthorizationFlow` — card 111
// (boards/project-backlog/111-realistic-adapter-tests.md), closing card 94's
// flag that this function (private to ./oauth.ts, reached only through
// `createMcpOAuthClient(...).runAuthorizationFlow`) had NO direct test
// coverage at all. ./oauth.test.ts covers `getValidAuth` (refresh) and
// `redirectUri()`, both over a stubbed `fetch`; ./oauth-metadata.test.ts
// covers `discoverAuthorizationServer`/`registerClient` the same way. Neither
// exercises the interactive authorization-code + PKCE dance itself.
//
// This suite runs the WHOLE discover -> register -> authorize -> token
// chain against a REAL local HTTP server (../testing/http-test-server.ts):
// the flow's own authorization URL is actually GETed, and the token exchange
// is a real form-encoded POST a real handler parses — not a hand-built
// `Response`. `chrome.identity.launchWebAuthFlow` is faked to do what a real
// browser + consenting user does: fetch the authorize URL with
// `redirect: "manual"` and hand back the `Location` header, so the redirect
// itself is produced by the server, not computed by the test.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ok } from "../../domain/result";
import type {
  McpAuthorizationServerInfo,
  McpAuthTokenStore,
  McpOAuthAuth,
  McpOAuthFlowConfig,
  McpServerConfig,
} from "../../domain/tools";
import { createMcpOAuthClient } from "./oauth";
import { discoverAuthorizationServer, registerClient } from "./oauth-metadata";
import { type HttpTestServer, useHttpTestServer } from "../testing/http-test-server";

afterEach(() => {
  vi.unstubAllGlobals();
});

const server = useHttpTestServer();

const REDIRECT_URI = "https://redirect.example/cb";
const AUTH_CODE = "auth-code-1";
const ACCESS_TOKEN = "at-issued";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function fakeTokenStore(): McpAuthTokenStore {
  return {
    async saveAuth() {
      return ok();
    },
  };
}

function flowConfig(
  srv: HttpTestServer,
  overrides: Partial<McpOAuthFlowConfig> = {},
): McpOAuthFlowConfig {
  return { serverUrl: srv.baseUrl, clientId: "client-1", ...overrides };
}

/** Registers RFC 9728 (404, so discovery falls back to the MCP server's own origin — the same simplest-realistic-shape oauth-metadata.test.ts's first test uses) and RFC 8414 metadata naming this server's own `/authorize`, `/token`, `/register` endpoints. */
function registerDiscoveryRoutes(srv: HttpTestServer): void {
  srv.route("GET", "/.well-known/oauth-protected-resource", ({ res }) => {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });
  srv.route("GET", "/.well-known/oauth-authorization-server", ({ res }) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        issuer: srv.baseUrl,
        authorization_endpoint: `${srv.baseUrl}/authorize`,
        token_endpoint: `${srv.baseUrl}/token`,
        registration_endpoint: `${srv.baseUrl}/register`,
      }),
    );
  });
}

async function discover(srv: HttpTestServer): Promise<McpAuthorizationServerInfo> {
  registerDiscoveryRoutes(srv);
  const [value, err] = await discoverAuthorizationServer(srv.baseUrl);
  if (err) throw err;
  return value;
}

function authorizeQuery(url: string | undefined, srv: HttpTestServer): URLSearchParams {
  return new URL(url ?? "", srv.baseUrl).searchParams;
}

/** SHA256(input) -> base64url, no padding — the same PKCE encoding ./oauth.ts's `generatePkce` uses, computed here server-side so the fake `/token` route can do a REAL `code_verifier` -> `code_challenge` check rather than trust a canned value. */
async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  let binary = "";
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type LaunchWebAuthFlow = (details: {
  url: string;
  interactive: boolean;
}) => Promise<string | undefined>;

/** The realistic default: actually GET the authorize URL with `redirect: "manual"` and hand back the `Location` header, exactly like a real browser window that a user just consented in. Node's fetch (undici) gives a real `status`/`Location` here — the "opaqueredirect" behaviour is a browser CORS-only thing that doesn't apply outside a page context. */
async function followRedirect(details: { url: string }): Promise<string | undefined> {
  const response = await fetch(details.url, { redirect: "manual" });
  return response.headers.get("location") ?? undefined;
}

function stubChromeIdentity(launchWebAuthFlow: LaunchWebAuthFlow = followRedirect): void {
  vi.stubGlobal("chrome", {
    identity: {
      getRedirectURL: () => REDIRECT_URI,
      launchWebAuthFlow,
    },
  } as unknown as typeof chrome);
}

// ---------------------------------------------------------------------------
// runAuthorizationFlow
// ---------------------------------------------------------------------------

describe("runAuthorizationFlow — real HTTP integration (card 94's untested flag, closed)", () => {
  it("happy path: discover -> register -> real /authorize redirect -> real /token exchange -> ok(McpOAuthAuth), with a real PKCE round-trip and RFC 8707 resource on the token POST", async () => {
    const srv = server();
    const discovery = await discover(srv);
    if (!discovery.registrationEndpoint) throw new Error("expected a registrationEndpoint");

    srv.route("POST", "/register", ({ res }) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ client_id: "registered-client", client_secret: "shh" }));
    });
    const [registration, registerErr] = await registerClient(
      discovery.registrationEndpoint,
      REDIRECT_URI,
    );
    if (registerErr) throw registerErr;

    let capturedChallenge: string | undefined;
    srv.route("GET", "/authorize", ({ req, res }) => {
      const query = authorizeQuery(req.url, srv);
      capturedChallenge = query.get("code_challenge") ?? undefined;
      const location = `${query.get("redirect_uri")}?code=${AUTH_CODE}&state=${query.get("state")}`;
      res.writeHead(302, { Location: location });
      res.end();
    });
    srv.route("POST", "/token", async ({ body, res }) => {
      const params = new URLSearchParams(body.toString());
      const verifier = params.get("code_verifier") ?? "";
      const computedChallenge = await sha256Base64Url(verifier);
      // Real PKCE round-trip: only issue the token when the presented
      // verifier actually hashes to the challenge captured off the real
      // /authorize request, not just "some value was sent."
      if (params.get("code") !== AUTH_CODE || computedChallenge !== capturedChallenge) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "invalid_grant", error_description: "code/PKCE mismatch" }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: ACCESS_TOKEN,
          refresh_token: "rt-1",
          expires_in: 3600,
          scope: "tools:read",
        }),
      );
    });

    stubChromeIdentity();
    const client = createMcpOAuthClient({ tokenStore: fakeTokenStore() });
    const config = flowConfig(srv, {
      clientId: registration.clientId,
      clientSecret: registration.clientSecret,
      scope: "tools:read",
    });

    const [auth, err] = await client.runAuthorizationFlow(config, discovery);

    if (err) throw err;
    expect(auth.accessToken).toBe(ACCESS_TOKEN);
    expect(auth.refreshToken).toBe("rt-1");
    expect(auth.clientId).toBe(registration.clientId);
    expect(auth.resource).toBe(srv.baseUrl);

    // Prove the real requests, not just the returned value.
    const authorizeReq = srv.requests.find(
      (r) => r.method === "GET" && r.url.startsWith("/authorize"),
    );
    expect(authorizeReq).toBeDefined();

    const tokenReq = srv.requests.find((r) => r.method === "POST" && r.url === "/token");
    expect(tokenReq).toBeDefined();
    expect(tokenReq?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const tokenBody = new URLSearchParams(tokenReq?.body.toString());
    expect(tokenBody.get("grant_type")).toBe("authorization_code");
    expect(tokenBody.get("code")).toBe(AUTH_CODE);
    expect(tokenBody.get("code_verifier")).toBeTruthy(); // PKCE (RFC 7636)
    expect(tokenBody.get("resource")).toBe(srv.baseUrl); // RFC 8707
    expect(tokenBody.get("client_id")).toBe(registration.clientId);
    expect(tokenBody.get("redirect_uri")).toBe(REDIRECT_URI);
  });

  it("user-cancelled: launchWebAuthFlow rejecting (window closed) resolves {kind: 'user-cancelled'}, and /authorize is never hit", async () => {
    const srv = server();
    const discovery = await discover(srv);
    stubChromeIdentity(async () => {
      throw new Error("User closed the sign-in window.");
    });
    const client = createMcpOAuthClient({ tokenStore: fakeTokenStore() });

    const [, err] = await client.runAuthorizationFlow(flowConfig(srv), discovery);

    expect(err).toEqual({ kind: "user-cancelled" });
    expect(srv.requests.some((r) => r.url.startsWith("/authorize"))).toBe(false);
  });

  it("user-cancelled via server-side decline: a real /authorize redirect carrying error=access_denied also resolves {kind: 'user-cancelled'} (RFC 6749 §4.1.2.1)", async () => {
    const srv = server();
    const discovery = await discover(srv);
    srv.route("GET", "/authorize", ({ req, res }) => {
      const query = authorizeQuery(req.url, srv);
      const location = `${query.get("redirect_uri")}?error=access_denied&state=${query.get("state")}`;
      res.writeHead(302, { Location: location });
      res.end();
    });
    stubChromeIdentity();
    const client = createMcpOAuthClient({ tokenStore: fakeTokenStore() });

    const [, err] = await client.runAuthorizationFlow(flowConfig(srv), discovery);

    expect(err).toEqual({ kind: "user-cancelled" });
  });

  it("a non-access_denied OAuth error (e.g. invalid_scope) from a real /authorize redirect stays kind 'auth', not a cancellation", async () => {
    const srv = server();
    const discovery = await discover(srv);
    srv.route("GET", "/authorize", ({ req, res }) => {
      const query = authorizeQuery(req.url, srv);
      const location = `${query.get("redirect_uri")}?error=invalid_scope&error_description=Unknown+scope+requested&state=${query.get("state")}`;
      res.writeHead(302, { Location: location });
      res.end();
    });
    stubChromeIdentity();
    const client = createMcpOAuthClient({ tokenStore: fakeTokenStore() });

    const [, err] = await client.runAuthorizationFlow(flowConfig(srv), discovery);

    expect(err).toEqual({ kind: "auth", message: "Unknown scope requested" });
  });

  it("state mismatch: a real /authorize redirect returning a state that doesn't match the request resolves kind 'auth' with a 'did not match' message", async () => {
    const srv = server();
    const discovery = await discover(srv);
    srv.route("GET", "/authorize", ({ req, res }) => {
      const query = authorizeQuery(req.url, srv);
      const location = `${query.get("redirect_uri")}?code=${AUTH_CODE}&state=not-the-real-state`;
      res.writeHead(302, { Location: location });
      res.end();
    });
    stubChromeIdentity();
    const client = createMcpOAuthClient({ tokenStore: fakeTokenStore() });

    const [, err] = await client.runAuthorizationFlow(flowConfig(srv), discovery);

    if (err?.kind !== "auth") throw new Error(`expected kind 'auth', got ${JSON.stringify(err)}`);
    expect(err.message).toContain("did not match");
  });

  it("builds the authorize URL with the documented query params before any user interaction (response_type, client_id, redirect_uri, code_challenge(_method), state, resource, scope)", async () => {
    const srv = server();
    const discovery = await discover(srv);
    let captured: URL | undefined;
    stubChromeIdentity(async (details) => {
      captured = new URL(details.url);
      throw new Error("stop here — this test only inspects the constructed URL");
    });
    const client = createMcpOAuthClient({ tokenStore: fakeTokenStore() });
    const config = flowConfig(srv, { scope: "tools:read tools:write" });

    await client.runAuthorizationFlow(config, discovery);

    if (!captured) throw new Error("launchWebAuthFlow was never called");
    expect(`${captured.origin}${captured.pathname}`).toBe(discovery.authorizationEndpoint);
    expect(captured.searchParams.get("response_type")).toBe("code");
    expect(captured.searchParams.get("client_id")).toBe(config.clientId);
    expect(captured.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(captured.searchParams.get("code_challenge_method")).toBe("S256");
    expect(captured.searchParams.get("code_challenge")).toBeTruthy();
    expect(captured.searchParams.get("state")).toBeTruthy();
    expect(captured.searchParams.get("resource")).toBe(config.serverUrl);
    expect(captured.searchParams.get("scope")).toBe("tools:read tools:write");
  });
});

// ---------------------------------------------------------------------------
// registerClient — standalone, against a real server (card 94: registration-rejected)
// ---------------------------------------------------------------------------

describe("registerClient — real HTTP (card 94's registration-rejected)", () => {
  it("a real registration endpoint returning a non-2xx is reported as registration-rejected", async () => {
    const srv = server();
    srv.route("POST", "/register", ({ res }) => {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("invalid_client_metadata");
    });

    const [, err] = await registerClient(`${srv.baseUrl}/register`, REDIRECT_URI);

    if (err?.kind !== "registration-rejected") {
      throw new Error(`expected registration-rejected, got ${JSON.stringify(err)}`);
    }
    expect(err.message).toContain("400");
    expect(err.message).toContain("invalid_client_metadata");
  });
});

// ---------------------------------------------------------------------------
// getValidAuth (refresh) — real HTTP, proving the real request shape drives
// the same classification oauth.test.ts already proves over a stubbed fetch.
// ---------------------------------------------------------------------------

describe("getValidAuth — real HTTP (card 94's refresh-expired)", () => {
  it("a real token endpoint returning a 400 with an RFC 6749 §5.2 error body for grant_type=refresh_token is reported as refresh-expired", async () => {
    const srv = server();
    srv.route("POST", "/token", ({ res }) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "invalid_grant", error_description: "Refresh token revoked" }),
      );
    });
    const client = createMcpOAuthClient({ tokenStore: fakeTokenStore() });
    const auth: McpOAuthAuth = {
      type: "oauth",
      accessToken: "at-old",
      refreshToken: "rt-old",
      clientId: "client-1",
      expiresAt: Date.now() - 1000,
      authorizationServer: {
        issuer: srv.baseUrl,
        authorizationEndpoint: `${srv.baseUrl}/authorize`,
        tokenEndpoint: `${srv.baseUrl}/token`,
      },
    };
    const config: McpServerConfig = {
      id: "s1",
      name: "Server",
      url: srv.baseUrl,
      enabled: true,
      transport: "auto",
      auth,
    };

    const [, err] = await client.getValidAuth(config);

    expect(err).toEqual({ kind: "refresh-expired", message: "Refresh token revoked" });

    const tokenReq = srv.requests.find((r) => r.method === "POST" && r.url === "/token");
    expect(tokenReq).toBeDefined();
    expect(tokenReq?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(tokenReq?.body.toString());
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-old");
  });
});

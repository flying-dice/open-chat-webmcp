// Tests for `McpOAuthClient.getValidAuth` — the refresh path over a stubbed
// `fetch`, and its best-effort persistence through the injected
// `McpAuthTokenStore` (card 83, card 76's "dissolved the oauth -> registry
// inversion").

import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpAuthTokenStore, McpOAuthAuth, McpServerConfig } from "../../domain/tools";
import { createMcpOAuthClient } from "./oauth";
import { jsonResponse } from "../testing/fetch-stub";

afterEach(() => {
  vi.unstubAllGlobals();
});

function serverConfig(auth?: McpOAuthAuth): McpServerConfig {
  return {
    id: "s1",
    name: "Server",
    url: "https://mcp.example",
    enabled: true,
    transport: "auto",
    auth,
  };
}

// `McpOAuthAuth.expiresAt` (src/domain/tools, not this folder's to widen) is
// optional without `| undefined`, so a plain `Partial<McpOAuthAuth>` can't
// express "clear expiresAt" the way this suite's "unset expiresAt" test
// needs — widened locally, just for this helper's parameter, rather than at
// the domain type.
function oauthAuth(
  overrides: Partial<Omit<McpOAuthAuth, "expiresAt">> & { expiresAt?: number | undefined } = {},
): McpOAuthAuth {
  // `expiresAt` is pulled out and re-added conditionally: an explicit
  // `expiresAt: undefined` override must OMIT the key from the returned
  // object (McpOAuthAuth's documented "unknown expiry"), which `...rest`
  // alone can't express since `overrides` may carry the key with an
  // `undefined` value.
  const { expiresAt, ...rest } = overrides;
  return {
    type: "oauth",
    accessToken: "at-current",
    refreshToken: "rt-1",
    clientId: "client-1",
    authorizationServer: {
      issuer: "https://as.example",
      authorizationEndpoint: "https://as.example/authorize",
      tokenEndpoint: "https://as.example/token",
    },
    ...rest,
    ...(expiresAt !== undefined && { expiresAt }),
  };
}

function fakeTokenStore(): McpAuthTokenStore & {
  saved: { serverId: string; auth: McpOAuthAuth }[];
} {
  const saved: { serverId: string; auth: McpOAuthAuth }[] = [];
  return {
    saved,
    async saveAuth(serverId, auth) {
      saved.push({ serverId, auth });
    },
  };
}

describe("getValidAuth", () => {
  it("no auth configured: fails immediately with kind 'auth', no fetch attempted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tokenStore = fakeTokenStore();
    const client = createMcpOAuthClient({ tokenStore });

    const result = await client.getValidAuth(serverConfig(undefined));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("auth");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("valid (far-future expiry): returns the stored auth unchanged, no fetch, nothing persisted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tokenStore = fakeTokenStore();
    const client = createMcpOAuthClient({ tokenStore });
    const auth = oauthAuth({ expiresAt: Date.now() + 3600_000 });

    const result = await client.getValidAuth(serverConfig(auth));

    expect(result).toEqual({ ok: true, value: auth });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tokenStore.saved).toEqual([]);
  });

  it("unset expiresAt (unknown expiry) is treated as still valid — no fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createMcpOAuthClient({ tokenStore: fakeTokenStore() });
    const auth = oauthAuth({ expiresAt: undefined });

    const result = await client.getValidAuth(serverConfig(auth));

    expect(result).toEqual({ ok: true, value: auth });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("near-expiry (inside the 60s skew window): triggers a refresh", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ access_token: "at-fresh", expires_in: 3600 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createMcpOAuthClient({ tokenStore: fakeTokenStore() });
    const auth = oauthAuth({ expiresAt: Date.now() + 30_000 }); // inside the 60s skew

    const result = await client.getValidAuth(serverConfig(auth));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.accessToken).toBe("at-fresh");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("expired with a refresh token: POSTs the refresh_token grant with the right body, and persists through the token store", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ access_token: "at-fresh", expires_in: 3600 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tokenStore = fakeTokenStore();
    const client = createMcpOAuthClient({ tokenStore });
    const auth = oauthAuth({ expiresAt: Date.now() - 1000 });
    const config = serverConfig(auth);

    const result = await client.getValidAuth(config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.accessToken).toBe("at-fresh");
    expect(result.value.refreshToken).toBe("rt-1"); // no new refresh token issued -> keep the old one

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://as.example/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-1");
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("resource")).toBe("https://mcp.example");

    expect(tokenStore.saved).toEqual([{ serverId: "s1", auth: result.value }]);
  });

  it("a server-issued replacement refresh token is kept over the old one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ access_token: "at-fresh", refresh_token: "rt-new", expires_in: 3600 }),
      ),
    );
    const client = createMcpOAuthClient({ tokenStore: fakeTokenStore() });
    const auth = oauthAuth({ expiresAt: Date.now() - 1000 });

    const result = await client.getValidAuth(serverConfig(auth));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.refreshToken).toBe("rt-new");
  });

  it("expired with no refresh token: fails with kind 'auth', no fetch attempted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createMcpOAuthClient({ tokenStore: fakeTokenStore() });
    const { refreshToken: _refreshToken, ...withoutRefresh } = oauthAuth({
      expiresAt: Date.now() - 1000,
    });

    const result = await client.getValidAuth(serverConfig(withoutRefresh));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("auth");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refresh rejected (RFC 6749 §5.2 error body): the token store is never written", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "invalid_grant", error_description: "Refresh token revoked" }),
            {
              status: 400,
            },
          ),
      ),
    );
    const tokenStore = fakeTokenStore();
    const client = createMcpOAuthClient({ tokenStore });
    const auth = oauthAuth({ expiresAt: Date.now() - 1000 });

    const result = await client.getValidAuth(serverConfig(auth));

    expect(result).toEqual({
      ok: false,
      error: { kind: "auth", status: 400, message: "Refresh token revoked" },
    });
    expect(tokenStore.saved).toEqual([]);
  });

  it("refresh fails on a network error (unreachable authorization server): propagates the classified error, nothing persisted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const tokenStore = fakeTokenStore();
    const client = createMcpOAuthClient({ tokenStore });
    const auth = oauthAuth({ expiresAt: Date.now() - 1000 });

    const result = await client.getValidAuth(serverConfig(auth));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unreachable");
    expect(tokenStore.saved).toEqual([]);
  });

  it("a successful refresh whose token-store persistence FAILS still resolves ok — the never-throws surface swallows the storage error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ access_token: "at-fresh", expires_in: 3600 })),
    );
    const failingTokenStore: McpAuthTokenStore = {
      saveAuth: vi.fn(async () => {
        // Deliberately NOT phrased as a literal "chrome . storage . <area> . <op>"
        // dotted chain — scripts/guard-boundaries.mjs's chrome.storage
        // containment scan is a blunt textual scan over every non-comment
        // line in src/ (not just src/domain), and that exact shape reads as
        // a real call site even inside a string literal.
        throw new Error("storage write failed: quota exceeded");
      }),
    };
    const client = createMcpOAuthClient({ tokenStore: failingTokenStore });
    const auth = oauthAuth({ expiresAt: Date.now() - 1000 });

    await expect(client.getValidAuth(serverConfig(auth))).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({ accessToken: "at-fresh" }),
    });
    expect(failingTokenStore.saveAuth).toHaveBeenCalled();
  });

  it("a malformed refresh response (no access_token) is reported as invalid-response, nothing persisted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ not_a_token: true })),
    );
    const tokenStore = fakeTokenStore();
    const client = createMcpOAuthClient({ tokenStore });
    const auth = oauthAuth({ expiresAt: Date.now() - 1000 });

    const result = await client.getValidAuth(serverConfig(auth));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid-response");
    expect(tokenStore.saved).toEqual([]);
  });

  it("a client secret, when present, is sent on the refresh request", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ access_token: "at-fresh", expires_in: 3600 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createMcpOAuthClient({ tokenStore: fakeTokenStore() });
    const auth = oauthAuth({ expiresAt: Date.now() - 1000, clientSecret: "secret-value" });

    await client.getValidAuth(serverConfig(auth));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("client_secret")).toBe("secret-value");
  });
});

describe("redirectUri()", () => {
  it("returns '' outside a chrome-extension context rather than throwing", () => {
    const client = createMcpOAuthClient({ tokenStore: fakeTokenStore() });
    expect(client.redirectUri()).toBe("");
  });
});

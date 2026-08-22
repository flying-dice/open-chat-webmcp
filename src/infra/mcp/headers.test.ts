// Tests for the headers a server's requests carry: decisions/15's
// reserved-header safety net and the bearer/oauth auth-resolution paths
// (card 83).

import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_CONTROLLED_HEADERS,
  type McpOAuthAuth,
  type McpServerConfig,
  type McpTokenResolver,
} from "../../domain/tools";
import { buildBaseHeaders, resolveAuthHeader } from "./headers";

function baseConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "s1",
    name: "Server",
    url: "https://mcp.example",
    enabled: true,
    transport: "auto",
    ...overrides,
  };
}

const oauthAuth: McpOAuthAuth = {
  type: "oauth",
  accessToken: "at-1",
  clientId: "client-1",
  authorizationServer: {
    issuer: "https://as.example",
    authorizationEndpoint: "https://as.example/authorize",
    tokenEndpoint: "https://as.example/token",
  },
};

describe("CLIENT_CONTROLLED_HEADERS", () => {
  it("is content-type and accept", () => {
    expect(CLIENT_CONTROLLED_HEADERS).toEqual(["content-type", "accept"]);
  });
});

describe("buildBaseHeaders — reserved-header protection", () => {
  it("drops content-type/accept custom headers regardless of case", () => {
    const config = baseConfig({
      headers: { "Content-Type": "text/plain", ACCEPT: "text/html", "X-Ok": "v" },
    });
    const result = buildBaseHeaders(config, {});
    expect(result).toEqual({ "X-Ok": "v" });
  });

  it("drops a custom Authorization header when a non-empty bearer token is configured", () => {
    const config = baseConfig({
      auth: { type: "bearer", token: "tok" },
      headers: { Authorization: "Bearer evil" },
    });
    const result = buildBaseHeaders(config, { Authorization: "Bearer tok" });
    expect(result).toEqual({ Authorization: "Bearer tok" });
  });

  it("does NOT reserve Authorization when the bearer token is empty — hasResolvableAuth is false", () => {
    const config = baseConfig({
      auth: { type: "bearer", token: "" },
      headers: { Authorization: "Bearer user-supplied" },
    });
    const result = buildBaseHeaders(config, {});
    expect(result).toEqual({ Authorization: "Bearer user-supplied" });
  });

  it("drops a custom Authorization header when oauth is configured (always resolvable)", () => {
    const config = baseConfig({ auth: oauthAuth, headers: { Authorization: "Bearer evil" } });
    const result = buildBaseHeaders(config, { Authorization: "Bearer real-token" });
    expect(result).toEqual({ Authorization: "Bearer real-token" });
  });

  it("the resolved auth header value always wins even without any custom headers", () => {
    const config = baseConfig();
    const result = buildBaseHeaders(config, { Authorization: "Bearer x" });
    expect(result).toEqual({ Authorization: "Bearer x" });
  });

  it("passes through unrelated custom headers untouched", () => {
    const config = baseConfig({ headers: { "X-Tenant": "acme", "X-Request-Id": "r1" } });
    const result = buildBaseHeaders(config, {});
    expect(result).toEqual({ "X-Tenant": "acme", "X-Request-Id": "r1" });
  });
});

describe("resolveAuthHeader", () => {
  it("bearer: resolves synchronously (wrapped in a promise) to Authorization: Bearer <token>", async () => {
    const config = baseConfig({ auth: { type: "bearer", token: "tok-1" } });
    const resolver: McpTokenResolver = { getValidAuth: vi.fn() };
    const result = await resolveAuthHeader(config, resolver);
    expect(result).toEqual({ ok: true, value: { Authorization: "Bearer tok-1" } });
    expect(resolver.getValidAuth).not.toHaveBeenCalled();
  });

  it("bearer with an empty token resolves to {} (no Authorization header)", async () => {
    const config = baseConfig({ auth: { type: "bearer", token: "" } });
    const resolver: McpTokenResolver = { getValidAuth: vi.fn() };
    const result = await resolveAuthHeader(config, resolver);
    expect(result).toEqual({ ok: true, value: {} });
  });

  it("no auth configured resolves to {} without calling the resolver", async () => {
    const config = baseConfig();
    const resolver: McpTokenResolver = { getValidAuth: vi.fn() };
    const result = await resolveAuthHeader(config, resolver);
    expect(result).toEqual({ ok: true, value: {} });
    expect(resolver.getValidAuth).not.toHaveBeenCalled();
  });

  it("oauth: asks the injected resolver and maps a valid token to Authorization: Bearer <accessToken>", async () => {
    const config = baseConfig({ auth: oauthAuth });
    const resolver: McpTokenResolver = {
      getValidAuth: vi.fn(async () => ({
        ok: true as const,
        value: { ...oauthAuth, accessToken: "at-fresh" },
      })),
    };
    const result = await resolveAuthHeader(config, resolver);
    expect(result).toEqual({ ok: true, value: { Authorization: "Bearer at-fresh" } });
    expect(resolver.getValidAuth).toHaveBeenCalledWith(config);
  });

  it("oauth: a resolver failure short-circuits as the same McpResult error, before any request is attempted", async () => {
    const config = baseConfig({ auth: oauthAuth });
    const resolver: McpTokenResolver = {
      getValidAuth: vi.fn(async () => ({
        ok: false as const,
        error: { kind: "auth" as const, message: "expired, no refresh token" },
      })),
    };
    const result = await resolveAuthHeader(config, resolver);
    expect(result).toEqual({
      ok: false,
      error: { kind: "auth", message: "expired, no refresh token" },
    });
  });
});

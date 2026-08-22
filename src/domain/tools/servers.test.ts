// Tests for the reserved-header rule in ./servers.ts (card 107,
// decisions/15-custom-headers-are-credentials.md). Zero platform mocks —
// pure function over plain data (decisions/30-vitest-test-pyramid.md). Mirrors
// src/domain/providers/provider.test.ts's `reservedHeaderReason` coverage for
// the sibling rule.
import { describe, expect, it } from "vitest";
import { oauthNeedsReconnect, validateServerHeaders, type McpOAuthAuth } from "./servers";

describe("validateServerHeaders", () => {
  it("returns no issues for undefined or an empty headers map", () => {
    expect(validateServerHeaders(undefined)).toEqual([]);
    expect(validateServerHeaders({})).toEqual([]);
  });

  it("flags content-type and accept as client-controlled, case-insensitively, keeping the typed casing", () => {
    expect(validateServerHeaders({ "Content-Type": "application/json" })).toEqual([
      { header: "Content-Type", code: "client-controlled" },
    ]);
    expect(validateServerHeaders({ ACCEPT: "text/event-stream" })).toEqual([
      { header: "ACCEPT", code: "client-controlled" },
    ]);
  });

  it("does not flag authorization when no auth token is configured", () => {
    expect(validateServerHeaders({ Authorization: "Bearer x" })).toEqual([]);
    expect(validateServerHeaders({ Authorization: "Bearer x" }, { hasAuthToken: false })).toEqual(
      [],
    );
  });

  it("flags authorization as authorization-bearer-token only while a token is configured", () => {
    expect(validateServerHeaders({ Authorization: "Bearer x" }, { hasAuthToken: true })).toEqual([
      { header: "Authorization", code: "authorization-bearer-token" },
    ]);
    expect(validateServerHeaders({ authorization: "Bearer x" }, { hasAuthToken: true })).toEqual([
      { header: "authorization", code: "authorization-bearer-token" },
    ]);
  });

  it("does not flag an arbitrary custom header name", () => {
    expect(validateServerHeaders({ "x-tenant-id": "acme" }, { hasAuthToken: true })).toEqual([]);
  });

  it("returns one issue per offending header, not just the first", () => {
    expect(
      validateServerHeaders(
        { "Content-Type": "application/json", Authorization: "Bearer x", "x-tenant-id": "acme" },
        { hasAuthToken: true },
      ),
    ).toEqual([
      { header: "Content-Type", code: "client-controlled" },
      { header: "Authorization", code: "authorization-bearer-token" },
    ]);
  });
});

// Card 113: the "reconnect needed" rule, lifted out of the two UI copies it
// used to live in (McpServerRow.svelte's badge condition and McpServerForm's
// live sign-in state). Pure over plain data plus an injected `now`.
describe("oauthNeedsReconnect", () => {
  const NOW = 1_700_000_000_000;

  function oauth(overrides: Partial<McpOAuthAuth> = {}): McpOAuthAuth {
    return {
      type: "oauth",
      accessToken: "token",
      clientId: "client",
      authorizationServer: {
        issuer: "https://auth.example.com",
        authorizationEndpoint: "https://auth.example.com/authorize",
        tokenEndpoint: "https://auth.example.com/token",
      },
      ...overrides,
    };
  }

  it("is false when there is no auth at all", () => {
    expect(oauthNeedsReconnect(undefined, NOW)).toBe(false);
  });

  it("is false for a bearer token, expired or not — the rule is about OAuth only", () => {
    expect(oauthNeedsReconnect({ type: "bearer", token: "t" }, NOW)).toBe(false);
  });

  it("is false when the expiry is unknown — valid until a 401 says otherwise", () => {
    expect(oauthNeedsReconnect(oauth(), NOW)).toBe(false);
  });

  it("is false while the access token is still in date", () => {
    expect(oauthNeedsReconnect(oauth({ expiresAt: NOW + 1 }), NOW)).toBe(false);
  });

  it("is true once the access token has expired with no refresh token", () => {
    expect(oauthNeedsReconnect(oauth({ expiresAt: NOW }), NOW)).toBe(true);
    expect(oauthNeedsReconnect(oauth({ expiresAt: NOW - 1 }), NOW)).toBe(true);
  });

  it("is false for an expired token that can still be refreshed silently", () => {
    expect(oauthNeedsReconnect(oauth({ expiresAt: NOW - 1, refreshToken: "r" }), NOW)).toBe(false);
  });
});

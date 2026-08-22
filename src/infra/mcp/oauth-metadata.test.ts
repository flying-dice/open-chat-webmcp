// Tests for RFC 9728/8414 authorization-server discovery and RFC 7591
// dynamic client registration (card 83) — including the path-inserted vs.
// bare-origin well-known URL priority the GitHub MCP server needed.

import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { discoverAuthorizationServer, registerClient } from "./oauth-metadata";
import { jsonResponse, stubFetchByUrl } from "../testing/fetch-stub";

afterEach(() => {
  vi.unstubAllGlobals();
});

const AS_METADATA = {
  issuer: "https://as.example",
  authorization_endpoint: "https://as.example/authorize",
  token_endpoint: "https://as.example/token",
  registration_endpoint: "https://as.example/register",
  scopes_supported: ["as-scope"],
};

describe("discoverAuthorizationServer", () => {
  it("no RFC 9728 document: falls back to the MCP server's own origin as issuer, and finds RFC 8414 metadata there", async () => {
    stubFetchByUrl({
      "https://mcp.example/.well-known/oauth-protected-resource": () =>
        new Response("not found", { status: 404 }),
      "https://mcp.example/.well-known/oauth-authorization-server": () => jsonResponse(AS_METADATA),
    });

    const result = await discoverAuthorizationServer("https://mcp.example");
    expect(result).toEqual([
      {
        issuer: "https://as.example",
        authorizationEndpoint: "https://as.example/authorize",
        tokenEndpoint: "https://as.example/token",
        registrationEndpoint: "https://as.example/register",
        scopesSupported: ["as-scope"],
      },
      undefined,
    ]);
  });

  it("an RFC 9728 protected-resource document names a different authorization server issuer, and prefers ITS scopes_supported", async () => {
    stubFetchByUrl({
      "https://mcp.example/.well-known/oauth-protected-resource": () =>
        jsonResponse({
          authorization_servers: ["https://other-as.example"],
          scopes_supported: ["resource-scope"],
        }),
      "https://other-as.example/.well-known/oauth-authorization-server": () =>
        jsonResponse(AS_METADATA),
    });

    const [value, error] = await discoverAuthorizationServer("https://mcp.example");
    if (error) throw error;
    expect(value.issuer).toBe("https://as.example");
    // The RESOURCE's scopes_supported win over the authorization server's own.
    expect(value.scopesSupported).toEqual(["resource-scope"]);
  });

  it("tries the path-inserted well-known URL first, falling back to the bare origin when it 404s (GitHub MCP server's shape)", async () => {
    const fetchMock = stubFetchByUrl({
      // Protected-resource discovery: path-inserted 404s, bare origin answers.
      "https://mcp.example/.well-known/oauth-protected-resource/mcp": () =>
        new Response("", { status: 404 }),
      "https://mcp.example/.well-known/oauth-protected-resource": () =>
        jsonResponse({ authorization_servers: ["https://github.com/login/oauth"] }),
      // Authorization-server metadata: path-inserted answers directly
      // (GitHub's actual documented shape — no fallback needed here).
      "https://github.com/.well-known/oauth-authorization-server/login/oauth": () =>
        jsonResponse(AS_METADATA),
    });

    const [, error] = await discoverAuthorizationServer("https://mcp.example/mcp");

    expect(error).toBeUndefined();
    const calledUrls = fetchMock.mock.calls.map((c) => c[0]);
    // Path-inserted attempted BEFORE the bare-origin fallback for protected-resource discovery.
    expect(
      calledUrls.indexOf("https://mcp.example/.well-known/oauth-protected-resource/mcp"),
    ).toBeLessThan(calledUrls.indexOf("https://mcp.example/.well-known/oauth-protected-resource"));
    // Path-inserted succeeded on the first try for the authorization-server metadata lookup.
    expect(calledUrls).toContain(
      "https://github.com/.well-known/oauth-authorization-server/login/oauth",
    );
  });

  it("invalid MCP server URL fails fast with not-mcp-endpoint, no fetch attempted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await discoverAuthorizationServer("not a url");
    expect(result).toEqual([
      undefined,
      { kind: "not-mcp-endpoint", message: '"not a url" is not a valid URL.' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("RFC 8414 metadata missing token_endpoint is rejected as invalid-response", async () => {
    stubFetchByUrl({
      "https://mcp.example/.well-known/oauth-protected-resource": () =>
        new Response("", { status: 404 }),
      "https://mcp.example/.well-known/oauth-authorization-server": () =>
        jsonResponse({
          issuer: "https://mcp.example",
          authorization_endpoint: "https://mcp.example/authorize",
        }),
    });
    const [, error] = await discoverAuthorizationServer("https://mcp.example");
    if (!error) throw new Error("expected discoverAuthorizationServer to fail");
    expect(error.kind).toBe("invalid-response");
  });

  it("neither well-known location has RFC 8414 metadata at all: reports discovery-absent (card 94)", async () => {
    stubFetchByUrl({
      "https://mcp.example/.well-known/oauth-protected-resource": () =>
        new Response("", { status: 404 }),
      "https://mcp.example/.well-known/oauth-authorization-server": () =>
        new Response("", { status: 404, statusText: "Not Found" }),
    });
    const [, error] = await discoverAuthorizationServer("https://mcp.example");
    if (!error) throw new Error("expected discoverAuthorizationServer to fail");
    expect(error.kind).toBe("discovery-absent");
  });
});

describe("registerClient", () => {
  it("registers as a public client and returns the client id (+ optional secret)", async () => {
    const fetchMock = stubFetchByUrl({
      "https://as.example/register": () =>
        jsonResponse({ client_id: "cid-1", client_secret: "shh" }),
    });

    const result = await registerClient(
      "https://as.example/register",
      "https://redirect.example/cb",
    );

    expect(result).toEqual([{ clientId: "cid-1", clientSecret: "shh" }, undefined]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      redirect_uris: ["https://redirect.example/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  it("a client_secret is optional — absent when the server doesn't return one", async () => {
    stubFetchByUrl({ "https://as.example/register": () => jsonResponse({ client_id: "cid-1" }) });
    const result = await registerClient(
      "https://as.example/register",
      "https://redirect.example/cb",
    );
    expect(result).toEqual([{ clientId: "cid-1", clientSecret: undefined }, undefined]);
  });

  it("a non-2xx response is reported as registration-rejected with the status and body (card 94)", async () => {
    stubFetchByUrl({
      "https://as.example/register": () =>
        new Response("invalid_client_metadata", { status: 400, statusText: "Bad Request" }),
    });
    const [, error] = await registerClient(
      "https://as.example/register",
      "https://redirect.example/cb",
    );
    if (error?.kind !== "registration-rejected") throw new Error("expected registration-rejected");
    expect(error.message).toContain("400");
    expect(error.message).toContain("invalid_client_metadata");
  });

  it("a response missing client_id is rejected as invalid-response — malformed 2xx, not a refusal", async () => {
    stubFetchByUrl({ "https://as.example/register": () => jsonResponse({ not_client_id: true }) });
    const [, error] = await registerClient(
      "https://as.example/register",
      "https://redirect.example/cb",
    );
    if (error?.kind !== "invalid-response") throw new Error("expected invalid-response");
    expect(error.message).toContain("did not return a client_id");
  });
});

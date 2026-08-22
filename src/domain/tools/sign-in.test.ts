// Chaos coverage for the MCP sign-in orchestration (card 85,
// .claude/skills/chaos-monkey/SKILL.md) — ./sign-in.ts had no dedicated test
// file at all before this card, despite being pure, ordering-sensitive
// domain logic (permission requests, discovery, registration, the PKCE flow,
// all awaited in one chain — see its own header comment on why the ORDER is
// load-bearing). These tests exercise what happens when a step in that
// chain is declined, fails, or only partially succeeds — never the happy
// path, which is implicitly exercised by the app itself.

import { describe, it, expect, vi } from "vitest";
import { createMcpSignIn } from "./sign-in";
import type { HostPermissions } from "../permissions";
import type {
  McpAuthorizationServerInfo,
  McpDynamicClientRegistration,
  McpOAuthClient,
} from "./gateway";
import type { McpOAuthAuth } from "./servers";
import type { McpError, McpResult } from "./types";

function ok<T>(value: T): McpResult<T> {
  return { ok: true, value };
}

function err<T>(error: McpError): McpResult<T> {
  return { ok: false, error };
}

function makePermissions(overrides: Partial<HostPermissions> = {}): HostPermissions & {
  requested: string[];
} {
  const requested: string[] = [];
  return {
    requested,
    has: vi.fn(async () => true),
    request: vi.fn(async (url: string) => {
      requested.push(url);
      return true;
    }),
    onChanged: vi.fn(() => () => undefined),
    ...overrides,
  };
}

const okAuth: McpOAuthAuth = {
  type: "oauth",
  accessToken: "tok",
  clientId: "client-1",
  authorizationServer: {
    issuer: "https://auth.example.com",
    authorizationEndpoint: "https://auth.example.com/authorize",
    tokenEndpoint: "https://auth.example.com/token",
  },
};

const okDiscovery: McpAuthorizationServerInfo = {
  issuer: "https://auth.example.com",
  authorizationEndpoint: "https://auth.example.com/authorize",
  tokenEndpoint: "https://auth.example.com/token",
  registrationEndpoint: "https://auth.example.com/register",
};

interface OauthOverrides {
  discoverAuthorizationServer?: () => Promise<McpResult<McpAuthorizationServerInfo>>;
  registerClient?: () => Promise<McpResult<McpDynamicClientRegistration>>;
  runAuthorizationFlow?: () => Promise<McpResult<McpOAuthAuth>>;
}

function makeOauth(overrides: OauthOverrides = {}): McpOAuthClient & {
  calls: {
    registerClient: number;
    runAuthorizationFlow: number;
    discoverAuthorizationServer: number;
  };
} {
  const calls = { registerClient: 0, runAuthorizationFlow: 0, discoverAuthorizationServer: 0 };
  const discoverAuthorizationServer = vi.fn(async () => {
    calls.discoverAuthorizationServer++;
    return overrides.discoverAuthorizationServer
      ? overrides.discoverAuthorizationServer()
      : ok(okDiscovery);
  });
  const registerClient = vi.fn(async () => {
    calls.registerClient++;
    return overrides.registerClient
      ? overrides.registerClient()
      : ok<McpDynamicClientRegistration>({ clientId: "client-1" });
  });
  const runAuthorizationFlow = vi.fn(async () => {
    calls.runAuthorizationFlow++;
    return overrides.runAuthorizationFlow ? overrides.runAuthorizationFlow() : ok(okAuth);
  });

  return {
    calls,
    redirectUri: () => "https://ext-id.chromiumapp.org/",
    discoverAuthorizationServer,
    registerClient,
    runAuthorizationFlow,
    getValidAuth: vi.fn(async () => ok(okAuth)),
  };
}

function makeSignIn(opts: { permissions?: HostPermissions; oauthOverrides?: OauthOverrides } = {}) {
  const permissions = opts.permissions ?? makePermissions();
  const oauth = makeOauth(opts.oauthOverrides);
  return { signIn: createMcpSignIn({ permissions, oauth }), permissions, oauth };
}

describe("chaos: McpSignIn.begin — invalid or declined input", () => {
  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["not a URL at all", "not-a-url"],
    ["a non-http(s) scheme", "ftp://example.com"],
    ["javascript: pseudo-scheme", "javascript:alert(1)"],
  ])("rejects '%s' before ever requesting a permission", async (_label, url) => {
    const { signIn, permissions } = makeSignIn();
    const result = await signIn.begin(url);
    expect(result.status).toBe("error");
    expect(permissions.request).not.toHaveBeenCalled();
  });

  it("stops immediately, with no discovery attempted, when the server's own host permission is declined", async () => {
    const permissions = makePermissions({ request: vi.fn(async () => false) });
    const { signIn, oauth } = makeSignIn({ permissions });

    const result = await signIn.begin("https://mcp.example.com");

    expect(result).toMatchObject({ status: "error" });
    expect(oauth.calls.discoverAuthorizationServer).toBe(0);
  });

  it("surfaces an error and stops when discovery itself fails", async () => {
    const { signIn, oauth } = makeSignIn({
      oauthOverrides: {
        discoverAuthorizationServer: async () =>
          err({ kind: "unreachable", message: "network unreachable" }),
      },
    });

    const result = await signIn.begin("https://mcp.example.com");

    expect(result.status).toBe("error");
    expect(oauth.calls.registerClient).toBe(0);
  });
});

describe("chaos: McpSignIn.begin — partial permission grants across multiple endpoints", () => {
  it("stops at the FIRST declined endpoint permission without requesting the remaining distinct origins", async () => {
    let call = 0;
    const permissions = makePermissions({
      request: vi.fn(async () => {
        call += 1;
        // The server's own origin (call 1) is granted; the first endpoint
        // origin encountered after it is declined.
        return call === 1;
      }),
    });
    const { signIn, oauth } = makeSignIn({
      permissions,
      oauthOverrides: {
        discoverAuthorizationServer: async () =>
          ok({
            issuer: "https://auth.example.com",
            authorizationEndpoint: "https://auth-a.example.com/authorize",
            tokenEndpoint: "https://auth-b.example.com/token", // a DIFFERENT origin
            registrationEndpoint: "https://auth-c.example.com/register", // and a third
          }),
      },
    });

    const result = await signIn.begin("https://mcp.example.com");

    expect(result).toMatchObject({ status: "error" });
    // Exactly 2 requests: the server's own origin, then the first (declined)
    // endpoint origin — the second and third distinct endpoint origins are
    // never even asked for. No rollback of the already-granted server
    // permission is attempted either; this only documents that partial
    // grants are left standing, not reversed.
    expect(permissions.request).toHaveBeenCalledTimes(2);
    expect(oauth.calls.registerClient).toBe(0);
  });

  it("requests each DISTINCT endpoint origin only once even when two endpoints share an origin", async () => {
    const permissions = makePermissions();
    const { signIn } = makeSignIn({
      permissions,
      oauthOverrides: {
        discoverAuthorizationServer: async () =>
          ok({
            issuer: "https://auth.example.com",
            authorizationEndpoint: "https://auth.example.com/authorize",
            tokenEndpoint: "https://auth.example.com/token", // same origin as above
            registrationEndpoint: "https://auth.example.com/register", // same origin again
          }),
      },
    });

    await signIn.begin("https://mcp.example.com");

    // Server origin + ONE shared endpoint origin = 2 total, not 4.
    expect(permissions.request).toHaveBeenCalledTimes(2);
  });
});

describe("chaos: McpSignIn.begin — failure between registration and the PKCE flow", () => {
  it("never starts the authorization flow when dynamic client registration is rejected", async () => {
    const { signIn, oauth } = makeSignIn({
      oauthOverrides: {
        registerClient: async () =>
          err({ kind: "not-mcp-endpoint", message: "registration_endpoint returned 404" }),
      },
    });

    const result = await signIn.begin("https://mcp.example.com");

    expect(result).toMatchObject({ status: "error" });
    expect(oauth.calls.runAuthorizationFlow).toBe(0);
  });

  it("reports an error (not 'signed-in') when registration succeeds but the user-gesture-bound authorization flow itself fails", async () => {
    const { signIn } = makeSignIn({
      oauthOverrides: { runAuthorizationFlow: async () => err({ kind: "aborted" }) },
    });

    const result = await signIn.begin("https://mcp.example.com");

    expect(result.status).toBe("error");
  });

  it("falls back to 'needs-manual-client' — never attempting registration or the flow — when discovery has no registration endpoint (e.g. GitHub)", async () => {
    const { signIn, oauth } = makeSignIn({
      oauthOverrides: {
        discoverAuthorizationServer: async () =>
          ok({
            issuer: "https://github.com",
            authorizationEndpoint: "https://github.com/login/oauth/authorize",
            tokenEndpoint: "https://github.com/login/oauth/access_token",
            // no registrationEndpoint
          }),
      },
    });

    const result = await signIn.begin("https://mcp.example.com");

    expect(result.status).toBe("needs-manual-client");
    expect(oauth.calls.registerClient).toBe(0);
    expect(oauth.calls.runAuthorizationFlow).toBe(0);
  });
});

describe("chaos: McpSignIn.completeManual — malformed or missing manual input", () => {
  const discovery: McpAuthorizationServerInfo = {
    issuer: "https://github.com",
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
  };

  it.each([
    ["empty string", ""],
    ["whitespace only", "   \t  "],
  ])(
    "rejects a client id that is %s without ever starting the authorization flow",
    async (_label, clientId) => {
      const { signIn, oauth } = makeSignIn();
      const result = await signIn.completeManual({
        serverUrl: "https://mcp.example.com",
        clientId,
        discovery,
      });
      expect(result.status).toBe("error");
      expect(oauth.calls.runAuthorizationFlow).toBe(0);
    },
  );

  it("trims a whitespace-only client secret down to undefined rather than sending it as an empty credential", async () => {
    const { signIn, oauth } = makeSignIn();

    await signIn.completeManual({
      serverUrl: "https://mcp.example.com",
      clientId: "  client-1  ",
      clientSecret: "   ",
      discovery,
    });

    const flowCall = (oauth.runAuthorizationFlow as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | { clientId: string; clientSecret?: string }
      | undefined;
    expect(flowCall?.clientId).toBe("client-1"); // trimmed
    expect(flowCall?.clientSecret).toBeUndefined(); // never an empty string on the wire
  });

  it("surfaces an error rather than 'signed-in' when the flow itself is rejected", async () => {
    const { signIn } = makeSignIn({
      oauthOverrides: {
        runAuthorizationFlow: async () =>
          err({ kind: "invalid-response", message: "server returned no access_token" }),
      },
    });

    const result = await signIn.completeManual({
      serverUrl: "https://mcp.example.com",
      clientId: "client-1",
      discovery,
    });

    expect(result.status).toBe("error");
  });
});

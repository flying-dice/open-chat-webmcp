// Unit tests for the MCP OAuth sign-in state machine (card 113, the split of
// McpServerForm.svelte's 0.5 SRP marker). The machine is the reason that
// component was the largest UI file in the tree, and it has four transitions
// worth pinning down without a DOM in the way: sign in, hand off to the
// manual registration panel, continue from it, and disconnect.
//
// Driven over src/options/testing/fake-services.ts's FAKE `OptionsServices`,
// like every other options test — no chrome.*, no network. `initFakeOptionsServices`
// is called exactly ONCE for the file (a `beforeAll`), per that module's
// header; each test overrides the `mcpSignIn` member it cares about.
//
// The module under test is a `.svelte.ts`, so its runes compile under the
// Vitest Svelte plugin (same arrangement as
// src/sidepanel/stores/notices.svelte.test.ts). This file itself uses no
// runes — it only reads the machine's getters.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOAuthSignIn, type OAuthSignInState } from "./oauthSignIn.svelte";
import type { HostPermissionState } from "./hostPermission.svelte";
import { createFakeOptionsServices, initFakeOptionsServices } from "../testing/fake-services";
import type {
  McpAuthorizationServerInfo,
  McpOAuthAuth,
  McpSignInManualInput,
  McpSignInResult,
} from "../../domain/tools";

const DISCOVERY: McpAuthorizationServerInfo = {
  issuer: "https://auth.example.com",
  authorizationEndpoint: "https://auth.example.com/authorize",
  tokenEndpoint: "https://auth.example.com/token",
  scopesSupported: ["repo", "user"],
};

function fakeAuth(overrides: Partial<McpOAuthAuth> = {}): McpOAuthAuth {
  return {
    type: "oauth",
    accessToken: "fake-token",
    clientId: "fake-client-id",
    authorizationServer: {
      issuer: DISCOVERY.issuer,
      authorizationEndpoint: DISCOVERY.authorizationEndpoint,
      tokenEndpoint: DISCOVERY.tokenEndpoint,
      scopesSupported: ["repo", "user"],
    },
    ...overrides,
  };
}

describe("createOAuthSignIn", () => {
  const services = createFakeOptionsServices();
  beforeAll(() => {
    initFakeOptionsServices(services);
  });

  let hostPermission: HostPermissionState;

  beforeEach(() => {
    hostPermission = { granted: undefined };
    services.mcpSignIn.begin = async () => ({ status: "signed-in", auth: fakeAuth() });
    services.mcpSignIn.completeManual = async () => ({ status: "signed-in", auth: fakeAuth() });
    services.mcpSignIn.redirectUri = () => "https://fake-extension-id.chromiumapp.org/";
  });

  function machine(initialAuth?: McpOAuthAuth): OAuthSignInState {
    return createOAuthSignIn({
      serverUrl: () => "https://mcp.example.com/mcp",
      hostPermission,
      initialAuth,
    });
  }

  it("starts disconnected, with no error and no manual panel", () => {
    const oauth = machine();

    expect(oauth.auth).toBeUndefined();
    expect(oauth.error).toBeUndefined();
    expect(oauth.signingIn).toBe(false);
    expect(oauth.showsManualPanel).toBe(false);
    expect(oauth.needsReconnect).toBe(false);
  });

  it("starts holding the credential an edited server was seeded with", () => {
    const oauth = machine(fakeAuth({ accessToken: "stored" }));

    expect(oauth.auth?.accessToken).toBe("stored");
  });

  it("reads the redirect URI through the port, never computing one of its own", () => {
    services.mcpSignIn.redirectUri = () => "https://other-id.chromiumapp.org/";

    expect(machine().redirectUri()).toBe("https://other-id.chromiumapp.org/");
  });

  it("holds the credential a successful sign-in returns", async () => {
    const oauth = machine();

    await oauth.signIn();

    expect(oauth.auth?.accessToken).toBe("fake-token");
    expect(oauth.error).toBeUndefined();
    expect(oauth.signingIn).toBe(false);
  });

  it("trims the typed URL and tells the service the grant it already has", async () => {
    let seen: { url: string; alreadyGranted: boolean | undefined } | undefined;
    hostPermission.granted = true;
    services.mcpSignIn.begin = async (serverUrl, opts) => {
      seen = { url: serverUrl, alreadyGranted: opts?.alreadyGranted };
      return { status: "signed-in", auth: fakeAuth() };
    };
    const oauth = createOAuthSignIn({
      serverUrl: () => "  https://mcp.example.com/mcp  ",
      hostPermission,
    });

    await oauth.signIn();

    expect(seen).toEqual({ url: "https://mcp.example.com/mcp", alreadyGranted: true });
  });

  it("records the grant verdict the service reports back, so the form's badge stays in step", async () => {
    services.mcpSignIn.begin = async (_url, opts) => {
      opts?.onServerPermission?.(false);
      return { status: "error", message: "declined" };
    };
    const oauth = machine();

    await oauth.signIn();

    expect(hostPermission.granted).toBe(false);
    expect(oauth.error).toBe("declined");
    expect(oauth.auth).toBeUndefined();
  });

  it("clears a stale error before the next attempt", async () => {
    const oauth = machine();
    services.mcpSignIn.begin = async () => ({ status: "error", message: "first failure" });
    await oauth.signIn();
    expect(oauth.error).toBe("first failure");

    services.mcpSignIn.begin = async () => ({ status: "signed-in", auth: fakeAuth() });
    await oauth.signIn();

    expect(oauth.error).toBeUndefined();
  });

  it("stays in flight until the service answers", async () => {
    let release: ((result: McpSignInResult) => void) | undefined;
    services.mcpSignIn.begin = () =>
      new Promise<McpSignInResult>((resolve) => {
        release = resolve;
      });
    const oauth = machine();

    const pending = oauth.signIn();
    expect(oauth.signingIn).toBe(true);

    release?.({ status: "signed-in", auth: fakeAuth() });
    await pending;
    expect(oauth.signingIn).toBe(false);
  });

  it("clears the in-flight flag even when the service rejects", async () => {
    services.mcpSignIn.begin = async () => {
      throw new Error("boom");
    };
    const oauth = machine();

    await expect(oauth.signIn()).rejects.toThrow("boom");
    expect(oauth.signingIn).toBe(false);
  });

  it("opens the manual registration panel when discovery found no registration endpoint", async () => {
    services.mcpSignIn.begin = async () => ({
      status: "needs-manual-client",
      discovery: DISCOVERY,
    });
    const oauth = machine();

    await oauth.signIn();

    expect(oauth.showsManualPanel).toBe(true);
    expect(oauth.discovery?.issuer).toBe(DISCOVERY.issuer);
    expect(oauth.auth).toBeUndefined();
  });

  it("does not show the manual panel once a credential is held", async () => {
    const oauth = machine(fakeAuth());
    services.mcpSignIn.begin = async () => ({
      status: "needs-manual-client",
      discovery: DISCOVERY,
    });

    await oauth.signIn();

    // `begin` cleared the held credential's panel state, not the credential:
    // a reconnect that lands on the manual branch still has the old token.
    expect(oauth.discovery).toBeDefined();
    expect(oauth.showsManualPanel).toBe(false);
  });

  it("continues a manual sign-in with the typed client id and secret, and a PLAIN discovery object", async () => {
    services.mcpSignIn.begin = async () => ({
      status: "needs-manual-client",
      discovery: DISCOVERY,
    });
    let seen: McpSignInManualInput | undefined;
    services.mcpSignIn.completeManual = async (input) => {
      seen = input;
      return { status: "signed-in", auth: fakeAuth({ accessToken: "manual-token" }) };
    };
    const oauth = machine();
    await oauth.signIn();
    oauth.manualClientId = "typed-client";
    oauth.manualClientSecret = "typed-secret";

    await oauth.continueManual();

    expect(seen?.clientId).toBe("typed-client");
    expect(seen?.clientSecret).toBe("typed-secret");
    // A reactive Proxy here is the "saved OAuth server reopens as auth: none"
    // bug — `scopesSupported` must survive as a real array.
    expect(Array.isArray(seen?.discovery.scopesSupported)).toBe(true);
    expect(oauth.auth?.accessToken).toBe("manual-token");
    expect(oauth.showsManualPanel).toBe(false);
    expect(oauth.manualClientId).toBe("");
    expect(oauth.manualClientSecret).toBe("");
  });

  it("does nothing at all when continue is pressed with no discovery to continue from", async () => {
    let called = false;
    services.mcpSignIn.completeManual = async () => {
      called = true;
      return { status: "signed-in", auth: fakeAuth() };
    };
    const oauth = machine();

    await oauth.continueManual();

    expect(called).toBe(false);
  });

  it("keeps the manual panel open, with its fields, when the manual sign-in fails", async () => {
    services.mcpSignIn.begin = async () => ({
      status: "needs-manual-client",
      discovery: DISCOVERY,
    });
    services.mcpSignIn.completeManual = async () => ({ status: "error", message: "bad client id" });
    const oauth = machine();
    await oauth.signIn();
    oauth.manualClientId = "typed-client";

    await oauth.continueManual();

    expect(oauth.error).toBe("bad client id");
    expect(oauth.showsManualPanel).toBe(true);
    expect(oauth.manualClientId).toBe("typed-client");
  });

  it("cancelling the manual panel drops its fields and its error but keeps any held credential", async () => {
    services.mcpSignIn.begin = async () => ({
      status: "needs-manual-client",
      discovery: DISCOVERY,
    });
    const oauth = machine(fakeAuth({ accessToken: "stored" }));
    await oauth.signIn();
    oauth.manualClientId = "typed-client";
    oauth.manualClientSecret = "typed-secret";

    oauth.cancelManual();

    expect(oauth.discovery).toBeUndefined();
    expect(oauth.manualClientId).toBe("");
    expect(oauth.manualClientSecret).toBe("");
    expect(oauth.error).toBeUndefined();
    expect(oauth.auth?.accessToken).toBe("stored");
  });

  it("disconnecting drops the credential too", async () => {
    const oauth = machine();
    await oauth.signIn();

    oauth.disconnect();

    expect(oauth.auth).toBeUndefined();
    expect(oauth.snapshotAuth()).toBeUndefined();
    expect(oauth.showsManualPanel).toBe(false);
  });

  it("reports needs-reconnect for an expired credential with no refresh token", () => {
    expect(machine(fakeAuth({ expiresAt: Date.now() - 1000 })).needsReconnect).toBe(true);
    expect(
      machine(fakeAuth({ expiresAt: Date.now() - 1000, refreshToken: "r" })).needsReconnect,
    ).toBe(false);
    expect(machine(fakeAuth({ expiresAt: Date.now() + 60_000 })).needsReconnect).toBe(false);
  });

  it("snapshots the credential as a plain, storage-safe object", async () => {
    const oauth = machine();

    await oauth.signIn();
    const snapshot = oauth.snapshotAuth();

    expect(snapshot).toEqual(fakeAuth());
    expect(Array.isArray(snapshot?.authorizationServer.scopesSupported)).toBe(true);
  });
});

// Signing in to an MCP server, as a rule rather than as a click handler
// (card 78, decisions/27-oauth-for-http-mcp-servers.md).
//
// This orchestration used to be ~110 lines inside
// src/options/components/McpServerForm.svelte, interleaved with that
// component's form state: three host-permission requests, RFC 9728/8414
// discovery, the RFC 7591 registration branch, the manual-client-id
// hand-off, and the PKCE flow itself. None of that is presentation — it is
// the ORDER the steps must happen in, and the order is load-bearing:
// permission before discovery, endpoint permissions before either
// registration or authorization, and every one of them awaited in the
// SAME call chain so the user gesture is never lost (decisions/27's
// Consequences: Chrome's tolerance for awaited work ahead of
// `launchWebAuthFlow` is not formally documented, so the flow defers nothing
// out of the click).
//
// It composes two driven ports and touches no platform API of its own:
//
//   `McpOAuthClient`  (./gateway.ts)        discovery, registration, the flow,
//                                           and the redirect URI it uses
//   `HostPermissions` (src/domain/permissions) the grants each origin needs
//
// so a composition root decides what implements them and this file stays
// runnable in a bare Node test. The component keeps its form state machine
// and calls `begin`/`completeManual`; what it renders for each outcome is
// still entirely its own.

import type { HostPermissions } from "../permissions";
import { originPatternForUrl } from "../permissions";
import type { McpAuthorizationServerInfo, McpOAuthClient } from "./gateway";
import type { McpOAuthAuth } from "./servers";
import { describeMcpError } from "./types";

/**
 * How a sign-in attempt ended.
 *
 *   `"signed-in"`             — hold `auth` and persist it when the form submits.
 *   `"needs-manual-client"`   — discovery succeeded but the authorization
 *                               server has no RFC 7591 registration endpoint
 *                               (GitHub's `github.com/login/oauth`, notably,
 *                               has none at all — confirmed against the real
 *                               server), so the user must register an app by
 *                               hand and come back through
 *                               {@link McpSignIn.completeManual}. `discovery`
 *                               is what that second call needs.
 *   `"error"`                 — `message` is already user-facing copy, scrubbed
 *                               of credentials by `describeMcpError`.
 */
export type McpSignInCompletion =
  | { status: "signed-in"; auth: McpOAuthAuth }
  | { status: "error"; message: string };

export type McpSignInResult =
  | McpSignInCompletion
  | { status: "needs-manual-client"; discovery: McpAuthorizationServerInfo };

export interface McpSignInBeginOptions {
  /**
   * Whether the caller already knows the MCP server's own host permission is
   * granted. `false`/`undefined` makes the request the FIRST `await` of the
   * whole chain — the only place a browser honours it.
   */
  alreadyGranted?: boolean;
  /**
   * Reports the host-permission verdict for the server's own URL back to the
   * caller, so a form's "Permission needed"/"Permission granted" badge stays
   * in step without re-checking. Called at most once, and only when this
   * service actually asked.
   */
  onServerPermission?: (granted: boolean) => void;
}

export interface McpSignInManualInput {
  serverUrl: string;
  /** From the OAuth app the user registered by hand at the authorization server. */
  clientId: string;
  clientSecret?: string;
  /** The `"needs-manual-client"` discovery this continues from. */
  discovery: McpAuthorizationServerInfo;
}

export interface McpSignIn {
  /** The redirect URI an authorization server must have registered — what the manual-registration panel shows the user to copy. */
  redirectUri(): string;

  /**
   * Run the whole sign-in for `serverUrl`. MUST be called from within a user
   * gesture with nothing awaited ahead of it: this asks for host permissions
   * and opens a sign-in window.
   */
  begin(serverUrl: string, opts?: McpSignInBeginOptions): Promise<McpSignInResult>;

  /**
   * Finish a `"needs-manual-client"` sign-in with a hand-registered client id.
   * Also a user-gesture call — its own fresh click is exactly as valid as
   * {@link McpSignIn.begin}'s. The endpoint host permissions were already
   * requested by the `begin` that produced `input.discovery`.
   */
  completeManual(input: McpSignInManualInput): Promise<McpSignInCompletion>;
}

export interface McpSignInDeps {
  oauth: McpOAuthClient;
  permissions: HostPermissions;
}

export function createMcpSignIn(deps: McpSignInDeps): McpSignIn {
  const { oauth, permissions } = deps;

  /**
   * Request the host permission for every DISTINCT origin among a discovered
   * authorization server's endpoints — they may differ from the MCP server's
   * own origin, and from each other. Returns an error result (not a boolean)
   * so the caller can return it straight through.
   */
  async function grantEndpointPermissions(
    discovery: McpAuthorizationServerInfo,
  ): Promise<McpSignInResult | undefined> {
    const endpointUrls = [
      discovery.authorizationEndpoint,
      discovery.tokenEndpoint,
      discovery.registrationEndpoint,
    ].filter((u): u is string => u !== undefined);

    const distinctOrigins = new Map<string, string>(); // origin pattern -> a URL on that origin
    for (const endpointUrl of endpointUrls) {
      const pattern = originPatternForUrl(endpointUrl);
      if (pattern && !distinctOrigins.has(pattern)) distinctOrigins.set(pattern, endpointUrl);
    }

    for (const endpointUrl of distinctOrigins.values()) {
      const granted = await permissions.request(endpointUrl);
      if (!granted) {
        return {
          status: "error",
          message: `Permission to contact ${new URL(endpointUrl).origin} was declined — sign-in cannot continue.`,
        };
      }
    }
    return undefined;
  }

  return {
    redirectUri: () => oauth.redirectUri(),

    async begin(serverUrl, opts) {
      const url = serverUrl.trim();
      if (!originPatternForUrl(url)) {
        return { status: "error", message: "Enter a valid http:// or https:// URL first." };
      }

      // 1. Host permission for the MCP server's own URL — first `await`, so
      //    the gesture is still live.
      if (opts?.alreadyGranted !== true) {
        const granted = await permissions.request(url);
        opts?.onServerPermission?.(granted);
        if (!granted) {
          return {
            status: "error",
            message:
              "This extension doesn't have permission to contact this host yet, and the request was declined.",
          };
        }
      }

      // 2. Discover the authorization server (RFC 9728 / RFC 8414).
      const discovery = await oauth.discoverAuthorizationServer(url);
      if (!discovery.ok) {
        return { status: "error", message: describeMcpError(discovery.error) };
      }

      // 3. Endpoint host permissions — needed either way (DCR or manual).
      const denied = await grantEndpointPermissions(discovery.value);
      if (denied) return denied;

      // 4/5. Dynamic client registration, if this server supports it —
      //      otherwise hand off to the manual client-id panel.
      if (!discovery.value.registrationEndpoint) {
        return { status: "needs-manual-client", discovery: discovery.value };
      }

      const registration = await oauth.registerClient(
        discovery.value.registrationEndpoint,
        oauth.redirectUri(),
      );
      if (!registration.ok) {
        return { status: "error", message: describeMcpError(registration.error) };
      }

      const flow = await oauth.runAuthorizationFlow(
        {
          serverUrl: url,
          clientId: registration.value.clientId,
          clientSecret: registration.value.clientSecret,
          scope: discovery.value.scopesSupported?.join(" "),
        },
        discovery.value,
      );
      if (!flow.ok) return { status: "error", message: describeMcpError(flow.error) };

      return { status: "signed-in", auth: flow.value };
    },

    async completeManual(input): Promise<McpSignInCompletion> {
      const clientId = input.clientId.trim();
      if (clientId.length === 0) {
        return {
          status: "error",
          message: "Enter the client ID from the OAuth app you registered.",
        };
      }

      const flow = await oauth.runAuthorizationFlow(
        {
          serverUrl: input.serverUrl.trim(),
          clientId,
          clientSecret:
            input.clientSecret && input.clientSecret.trim().length > 0
              ? input.clientSecret.trim()
              : undefined,
          scope: input.discovery.scopesSupported?.join(" "),
        },
        input.discovery,
      );
      if (!flow.ok) return { status: "error", message: describeMcpError(flow.error) };

      return { status: "signed-in", auth: flow.value };
    },
  };
}

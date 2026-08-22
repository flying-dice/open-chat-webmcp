// The MCP form's OAuth sign-in STATE MACHINE (card 113).
//
// Card 78 already moved the sign-in ORCHESTRATION — three host-permission
// requests, RFC 9728/8414 discovery, the RFC 7591 registration branch and the
// PKCE flow, in a fixed and load-bearing order — into `McpSignIn`
// (src/domain/tools/sign-in.ts). What that card left inside
// McpServerForm.svelte was the other half: which panel is showing, whether a
// sign-in is in flight, what the last error was, and the credential held in
// memory until the surrounding form submits. That half is a state machine
// with four transitions and nothing to do with the form's fields, and it is
// what made McpServerForm the largest UI file in the tree (its 0.5 SRP
// marker). It lives here now; McpServerForm.svelte keeps fields + validation,
// and McpOAuthPanel.svelte renders this state.
//
// This is a UI-LAYER split, deliberately: the domain service stays the home
// of the rule, this module holds no rule of its own. Every decision it makes
// is "what does the user see next", and the one predicate it needs about a
// credential (`oauthNeedsReconnect`) it imports from src/domain/tools rather
// than re-deriving.
//
// A `.svelte.ts` module, not a plain one, because the machine IS reactive
// state — the same reason ./hostPermission.svelte.ts is one. Unlike that
// module it owns no `$effect`, so it can be constructed and driven from a
// plain unit test (see ./oauthSignIn.svelte.test.ts) as well as from a
// component's initialisation.

import {
  oauthNeedsReconnect,
  type McpAuthorizationServerInfo,
  type McpOAuthAuth,
} from "../../domain/tools";
import { optionsServices } from "../app-services";
import type { HostPermissionState } from "./hostPermission.svelte";

export interface OAuthSignInDeps {
  /** The MCP server URL currently typed into the form — read at click time, never captured, so a URL edited between renders is the one signed in to. */
  serverUrl: () => string;
  /** The form's live grant state for that URL. Read to skip a redundant request, and written back with the verdict when the service does ask (`McpSignInBeginOptions.onServerPermission`), so the form's badge stays in step. */
  hostPermission: HostPermissionState;
  /** The credential the form was seeded with, for an "edit" of a server already signed in. */
  initialAuth?: McpOAuthAuth | undefined;
}

export interface OAuthSignInState {
  /** The credential to persist on submit — `undefined` before a first sign-in and after {@link OAuthSignInState.disconnect}. */
  readonly auth: McpOAuthAuth | undefined;
  /** A sign-in (either entry point) is in flight; both buttons disable. */
  readonly signingIn: boolean;
  /** The last failure, already user-facing copy scrubbed by the domain service. */
  readonly error: string | undefined;
  /** Whether the manual client-id/secret panel is what should be showing, rather than the sign-in status line. */
  readonly showsManualPanel: boolean;
  /** The authorization server the manual panel is registering against — set exactly when {@link OAuthSignInState.showsManualPanel} is true. */
  readonly discovery: McpAuthorizationServerInfo | undefined;
  /** Whether the held credential has expired with no refresh token (src/domain/tools's `oauthNeedsReconnect`) — the form's status line says the same thing the row's badge does. */
  readonly needsReconnect: boolean;
  /** The manual panel's two fields, bound by the panel component. */
  manualClientId: string;
  manualClientSecret: string;
  /** The redirect URI the flow actually sends, read through the port so the panel can never show one the flow does not use. */
  redirectUri(): string;
  /** "Sign in" / "Reconnect". MUST be called straight from the click handler — see {@link OAuthSignInState} usage note below. */
  signIn(): Promise<void>;
  /** "Continue" from the manual panel — its own fresh gesture, equally valid. */
  continueManual(): Promise<void>;
  cancelManual(): void;
  disconnect(): void;
  /**
   * The credential as a PLAIN object, for the moment it crosses out to the
   * registry. `$state.snapshot`, not a direct read: `auth` is reactive state,
   * so reading it back returns a Proxy, and `chrome.storage.local.set` does
   * not preserve that Proxy's array-ness for nested fields (confirmed:
   * `authorizationServer.scopesSupported` round-tripped as
   * `{0: "repo", 1: "…"}` instead of a real array), which then failed
   * `isMcpServerAuth`'s `Array.isArray` check on the next read and silently
   * dropped the WHOLE auth object — the "saved OAuth server reopens as
   * auth: none" bug. Snapshotting at this one boundary guarantees a plain,
   * storage-safe object however many reactive layers accumulated upstream.
   */
  snapshotAuth(): McpOAuthAuth | undefined;
}

/**
 * Build the machine. Both `signIn` and `continueManual` must be awaited
 * straight through from the click handler that calls them, with nothing
 * deferred out of it: `chrome.identity.launchWebAuthFlow` (inside the flow)
 * needs an active user gesture and Chrome's tolerance for `await`ed work
 * ahead of it isn't formally documented (decisions/27's Consequences). This
 * module adds no `await` of its own ahead of the service call for exactly
 * that reason.
 */
export function createOAuthSignIn(deps: OAuthSignInDeps): OAuthSignInState {
  let auth = $state<McpOAuthAuth | undefined>(deps.initialAuth);
  let signingIn = $state(false);
  let error = $state<string | undefined>(undefined);
  /**
   * Set once discovery has succeeded but found no `registrationEndpoint` —
   * some real authorization servers (GitHub's, notably: github.com/login/oauth
   * has no RFC 7591 registration endpoint at all) require a manually
   * pre-registered app instead of dynamic client registration. While this is
   * set (and `auth` isn't), the manual panel shows instead of the sign-in
   * status line. Cleared by `cancelManual` and `disconnect`.
   */
  let discovery = $state<McpAuthorizationServerInfo | undefined>(undefined);
  let manualClientId = $state("");
  let manualClientSecret = $state("");

  function clearManual(): void {
    discovery = undefined;
    manualClientId = "";
    manualClientSecret = "";
    error = undefined;
  }

  return {
    get auth() {
      return auth;
    },
    get signingIn() {
      return signingIn;
    },
    get error() {
      return error;
    },
    get discovery() {
      return discovery;
    },
    get showsManualPanel() {
      return discovery !== undefined && auth === undefined;
    },
    get needsReconnect() {
      return oauthNeedsReconnect(auth);
    },
    get manualClientId() {
      return manualClientId;
    },
    set manualClientId(next: string) {
      manualClientId = next;
    },
    get manualClientSecret() {
      return manualClientSecret;
    },
    set manualClientSecret(next: string) {
      manualClientSecret = next;
    },

    redirectUri(): string {
      return optionsServices().mcpSignIn.redirectUri();
    },

    async signIn(): Promise<void> {
      error = undefined;
      discovery = undefined;

      signingIn = true;
      try {
        const result = await optionsServices().mcpSignIn.begin(deps.serverUrl().trim(), {
          alreadyGranted: deps.hostPermission.granted === true,
          onServerPermission: (granted) => (deps.hostPermission.granted = granted),
        });
        if (result.status === "error") {
          error = result.message;
          return;
        }
        if (result.status === "needs-manual-client") {
          discovery = result.discovery;
          return;
        }
        auth = result.auth;
      } finally {
        signingIn = false;
      }
    },

    async continueManual(): Promise<void> {
      if (!discovery) return;

      error = undefined;
      signingIn = true;
      try {
        // Snapshot `discovery` before it is threaded into the resulting
        // `McpOAuthAuth.authorizationServer` (the flow carries this
        // `discovery` argument straight through) — otherwise `auth` ends up
        // holding a reactive Proxy nested inside plain state from the moment
        // it is created, not just when `snapshotAuth()` reads it out.
        const result = await optionsServices().mcpSignIn.completeManual({
          serverUrl: deps.serverUrl().trim(),
          clientId: manualClientId,
          clientSecret: manualClientSecret,
          discovery: $state.snapshot(discovery),
        });
        if (result.status === "error") {
          error = result.message;
          return;
        }
        auth = result.auth;
        discovery = undefined;
        manualClientId = "";
        manualClientSecret = "";
      } finally {
        signingIn = false;
      }
    },

    cancelManual(): void {
      clearManual();
    },

    disconnect(): void {
      auth = undefined;
      clearManual();
    },

    snapshotAuth(): McpOAuthAuth | undefined {
      return auth ? $state.snapshot(auth) : undefined;
    },
  };
}

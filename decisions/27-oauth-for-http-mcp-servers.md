---
status: Accepted
date: 2026-08-20
---
# Decision 27 — OAuth 2.1 (PKCE) as a second auth mode for HTTP MCP servers

## Context

decisions/14-backend-mcp-servers.md and card 37 gave the MCP server registry
a single auth mode: a static bearer token the user pastes in, stored exactly
like a provider's `apiKey` (decisions/10). Several production remote MCP
servers (Linear, Notion, Sentry, and others) instead require the OAuth 2.1
authorization-code flow the MCP spec (2025-06-18) describes for HTTP
transports — there's no static token to paste. Without this, those servers
are simply unreachable from the extension.

## Decision

Add OAuth as a second, coexisting `McpServerAuth` variant — not a
replacement for the bearer-token path, which stays exactly as-is for servers
that use it.

Scope the OAuth path to what the spec's discovery chain covers directly:

- Authorization Server discovery via the RFC 9728
  (`/.well-known/oauth-protected-resource`) and RFC 8414
  (`/.well-known/oauth-authorization-server`) well-known endpoints.
- Dynamic Client Registration (RFC 7591) when the discovered authorization
  server advertises a `registration_endpoint` — this extension is always a
  public client (`token_endpoint_auth_method: "none"`), never a confidential
  one.
- Authorization Code + PKCE (S256), via `chrome.identity.launchWebAuthFlow`
  for the interactive redirect, with the RFC 8707 `resource` parameter set
  to the MCP server's own URL on both the authorization and token requests
  (the spec's mitigation against a token issued for one resource being
  replayed against another).
- Refresh-token renewal (RFC 6749 §6), done transparently inside the
  existing connect path — a caller of `client.ts` never has to know whether
  a server uses a bearer token or OAuth.

Explicitly out of scope for v1: parsing a `WWW-Authenticate` challenge off an
unauthenticated 401 to locate resource metadata (the direct well-known GETs,
including the path-insertion form below, cover every server this discovery
chain is meant for).

**Revised during implementation**: manual client_id/secret entry, originally
deferred here, was added after hand-testing against GitHub's real MCP server
(`https://api.githubcopilot.com/mcp/`) showed its authorization server
(`github.com/login/oauth`) has no RFC 7591 registration endpoint at all —
GitHub requires a manually pre-registered OAuth App or GitHub App instead.
Rather than leave a real, high-value server permanently unsupported, the
sign-in flow now falls back to a manual client-id (and optional secret)
panel whenever discovery finds no `registrationEndpoint`, surfacing the
extension's `chrome.identity.getRedirectURL()` callback URL so the user can
register an app with it. Dynamic Client Registration remains the default,
automatic path for any server that supports it.

The same hand-test also surfaced a genuine discovery bug, now fixed: RFC
9728 §3.1 and RFC 8414 §3.1 both locate a resource/issuer's metadata by
INSERTING the well-known segment before the URL's path when it has one, not
by appending it to the bare origin — GitHub's protected-resource document
only answers at `/.well-known/oauth-protected-resource/mcp` (path-inserted),
and its issuer's authorization-server metadata only at
`/.well-known/oauth-authorization-server/login/oauth`, both 404ing at the
bare-origin form this module originally tried. Both lookups now try the
path-inserted URL first, falling back to the bare-origin form second.

A third gap surfaced the same way, after sign-in against GitHub succeeded
but every tool call then failed as a permission error: the authorization
request never carried a `scope` parameter at all. RFC 9728's
`scopes_supported` on the protected-resource document is exactly the
resource server telling a client what its tools need — GitHub's names
`repo`, `read:org`, `notifications`, `workflow`, and others — but this
module discarded that field entirely, so every sign-in issued a token with
no meaningful grants regardless of server. Fixed: `discoverAuthorizationServer`
now carries `scopesSupported` through in its result (preferring RFC 9728's
resource-specific list; falling back to RFC 8414's authorization-server-wide
one only if the resource didn't publish its own), and the sign-in flow
requests the full advertised set on the authorization request. No scope
picker in this version — every server-advertised scope is requested, which
is what most OAuth-enabled MCP clients do absent a more specific signal;
narrowing the request to only what's actually needed is a possible future
refinement, not attempted here.

A fourth issue, found the same way (a real end-to-end reproduction against
GitHub, then a faithful local stand-in once the shape of the bug was clear):
after signing in via the manual client-id panel, saving, and reopening the
server to edit it, the auth mode had silently reverted to "None" — the
stored credential was gone. Root cause was in the UI layer, not this
module: `McpServerForm.svelte` holds the discovered authorization-server
metadata (`oauthDiscovery`) and the resulting credential (`oauthAuth`) in
Svelte `$state`, and reading a `$state` object back out returns a reactive
Proxy, not the plain value that was assigned. That Proxy's nested
`authorizationServer.scopesSupported` array did not survive
`chrome.storage.local.set`'s serialization as a real array (it round-tripped
as `{0: "repo", 1: "read:org", ...}`), which then failed
`isMcpServerAuth`'s `Array.isArray` check on the very next read — and per
this module's own "drop rather than crash on corrupted storage" posture,
the entire auth object was silently discarded, not just the malformed
field. Fixed by snapshotting with `$state.snapshot()` at the two points a
reactive value crosses out of the form into `registry.ts`: once where
`oauthDiscovery` is threaded into the credential `runAuthorizationFlow`
builds, and once where `buildData()` hands the finished credential to
`addServer`/`updateServer`. Confirmed fixed end-to-end (sign in through the
manual panel → save → Test Connection on the saved row → reopen to edit) via
a real driven browser session, both before (reproduced the exact symptom)
and after (all three steps succeed) the fix. The automatic
Dynamic-Client-Registration path never carried discovery through `$state`
this way, so it was never affected — only the manual-client-id path (the one
GitHub itself needs) was.

Storage: an OAuth server's tokens, its registered `clientId` (and
`clientSecret` if a server happens to return one), and the authorization
server metadata needed to refresh without re-discovering are kept together
as one object in `chrome.storage.local` under the registry's existing
`mcp:auth:<id>` key (registry.ts) — the same key and locality the bearer
token already uses, just a differently-shaped payload for
`{ type: "oauth" }`. No new storage key, no split between "secret" and
"metadata" parts of the object: none of it is meant to sync, and splitting
it further buys nothing a single local blob doesn't already provide.

Per the project's pre-release status, there is no existing stored data to
migrate — `McpServerAuth`'s type guard simply grows to recognize the new
shape, and anything that doesn't parse is dropped the same way corrupted
storage already is handled today.

Requires adding the `identity` permission to the manifest
(`chrome.identity.launchWebAuthFlow`). No `oauth2` manifest key is needed —
that key only applies to Chrome's Google-specific `getAuthToken` flow, not
the generic web-auth-flow this uses.

## Consequences

- `client.ts`'s `connect()` gains one async step (resolving/refreshing an
  OAuth token before building request headers) on the OAuth path only; the
  bearer-token path is byte-for-byte unchanged.
- A server whose refresh token has expired or been revoked needs a fresh
  interactive sign-in — refresh failure surfaces as the same `"auth"`
  `McpError` kind an expired bearer token would, so the rest of the
  extension (test-connection, the agent loop's tool-call error path) doesn't
  need a new error kind to handle it, but the management UI does need a way
  to show "reconnect needed" distinctly from "add a token", since there's no
  token field to edit — there's a sign-in flow to re-run.
- `chrome.identity.launchWebAuthFlow`'s interactive step must be initiated
  from a user gesture. Chrome's tolerance for `await`ed work between the
  click and that call isn't formally documented, so this needs manual
  verification once implemented, the same way the existing
  `chrome.permissions.request`-from-gesture rule (decisions/09) already
  requires care in every form that uses it.
- Discovery, registration, and token exchange are all `fetch` calls to
  hosts that may differ from the MCP server's own origin (a separate
  identity provider, for instance) — each such origin needs its own
  `chrome.permissions.request` grant via the same optional-host-permission
  flow decisions/14 established, requested as discovery finds each origin,
  still inside the same gesture-triggered handler.

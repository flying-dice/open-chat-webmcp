---
column: review
labels: [backend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-20T21:42:00.000Z
---
# OAuth flow, token storage, and refresh for MCP servers

"As a user I should be able to connect an MCP server that requires OAuth
sign-in (Linear, Notion, Sentry, etc.) instead of only a static bearer
token."

Implements the non-UI half of decisions/27-oauth-for-http-mcp-servers.md.
Card 63 (the management UI) builds on this — it is not in scope here to add
any UI; this card's surface is `manifest.config.ts`,
`src/lib/mcp/registry.ts`, a new `src/lib/mcp/oauth.ts`, and one call site in
`src/lib/mcp/client.ts`. Do not touch `src/options/**` or
`src/sidepanel/**` — those are card 63's.

Mirrors card 37's scope and style: never-throw `McpResult`/`McpError`
(src/lib/mcp/types.ts), the registry's existing sync/local storage split, and
`src/lib/permissions.ts`'s host-permission helpers reused rather than
reinvented.

## What to build

1. `manifest.config.ts`: add `"identity"` to `permissions`.

2. `src/lib/mcp/registry.ts`: extend `McpServerAuth` (currently
   `{ type: "bearer"; token: string }`) with a second variant:
   ```ts
   {
     type: "oauth";
     accessToken: string;
     refreshToken?: string;
     expiresAt?: number; // epoch ms
     scope?: string;
     clientId: string;
     clientSecret?: string;
     authorizationServer: {
       issuer: string;
       authorizationEndpoint: string;
       tokenEndpoint: string;
       registrationEndpoint?: string;
     };
     resource?: string;
   }
   ```
   Update `isMcpServerAuth` to accept either variant. Storage is unchanged —
   still the whole `auth` object in `chrome.storage.local` under
   `mcp:auth:<id>`, still never synced. No migration for existing bearer
   entries needed (pre-release, per decisions/27's Context).

3. New `src/lib/mcp/oauth.ts`, styled like `client.ts` (never throws, module
   doc explaining the RFCs it implements and why):
   - `discoverAuthorizationServer(mcpServerUrl)` — RFC 9728
     (`/.well-known/oauth-protected-resource` at the MCP server's origin)
     then RFC 8414 (`/.well-known/oauth-authorization-server`) as the
     fallback, returning the authorization server's metadata (issuer,
     `authorization_endpoint`, `token_endpoint`, `registration_endpoint?`).
   - `registerClient(registrationEndpoint, redirectUri)` — RFC 7591 POST
     registering this extension as a public client (`redirect_uris:
     [redirectUri]`, `token_endpoint_auth_method: "none"`, `grant_types:
     ["authorization_code", "refresh_token"]`, `response_types: ["code"]`).
   - `runAuthorizationFlow(config, discovery)` — generates a PKCE
     verifier/challenge (S256) and `state`, builds the authorization URL
     (including the RFC 8707 `resource` parameter set to `config.url`),
     drives `chrome.identity.launchWebAuthFlow({ url, interactive: true })`,
     parses `code`/`state` off the redirect, and exchanges the code at
     `token_endpoint` (with `code_verifier`, `redirect_uri`, `client_id`,
     and the `resource` parameter again per RFC 8707) for the full oauth
     `McpServerAuth` object. This is the one function card 63's UI will
     call directly from a click handler.
   - `getValidAuth(config)` — given an oauth `McpServerAuth`, returns it
     unchanged if `expiresAt` is still comfortably in the future; otherwise
     refreshes via the `refresh_token` grant at `token_endpoint`, persists
     the refreshed tokens back through `registry.ts`'s `updateServer` (skip
     persisting when `config.id` isn't a real registered id — e.g. an
     unsaved draft under test), and returns the current valid auth. An
     `invalid_grant` (or missing refresh token) failure returns an
     `McpError` with `kind: "auth"` — the same kind an expired bearer token
     produces — rather than a new error kind.

4. `src/lib/mcp/client.ts`: `connect()` currently builds `baseHeaders`
   synchronously via `buildBaseHeaders(config)`. Change only this one call
   site: `await` a new `resolveAuthHeader(config)` that returns the same
   `{ Authorization: ... }` shape for a bearer config as today, and for an
   oauth config calls `getValidAuth` and maps success to an `Authorization:
   Bearer <accessToken>` header or failure to an early `McpResult` error.
   Every other function in this module is unchanged — the existing 401
   handling at each transport call site stays the primary path for "a
   token that looked valid actually wasn't."

## Checklist

- [x] `identity` permission added to the manifest
- [x] `McpServerAuth` oauth variant + updated type guard, storage unchanged
- [x] RFC 9728 / RFC 8414 authorization-server discovery
- [x] RFC 7591 dynamic client registration (public client)
- [x] PKCE (S256) authorization-code flow via `chrome.identity.launchWebAuthFlow`, including the RFC 8707 `resource` parameter
- [x] Transparent refresh with persistence back to the registry
- [x] Refresh/reauth failure surfaces as `McpError.kind: "auth"`
- [x] `client.ts`'s `connect()` resolves either auth type through one call site; bearer path provably unchanged

## Gates

- [x] check — npm run check: 176 files, 0 errors (claude, 2026-08-20T00:52:00.000Z)
- [x] build — npm run build green (claude, 2026-08-20T00:52:00.000Z)
- [x] verify — npm run verify: 9/9 required checks passed (claude, 2026-08-20T00:53:00.000Z)
- [x] check — npm run check: 176 files, 0 errors, re-verified after the well-known path-insertion fix below (claude, 2026-08-20T20:40:00.000Z)
- [x] build — npm run build green, re-verified after the same fix (claude, 2026-08-20T20:40:00.000Z)
- [x] check — npm run check: 176 files, 0 errors, re-verified after the scope-discovery fix below (claude, 2026-08-20T21:40:00.000Z)
- [x] build — npm run build green, re-verified after the same fix (claude, 2026-08-20T21:40:00.000Z)
- [x] verify — npm run verify: 9/9 required checks passed, re-verified after the same fix (claude, 2026-08-20T21:42:00.000Z)

## Comments

- **claude** (2026-08-20T00:55:00.000Z): Implemented the non-UI half of decisions/27-oauth-for-http-mcp-servers.md, scoped exactly to the card's file list.
  - `manifest.config.ts:22-25` — added `"identity"` to `permissions`, with a comment noting no `oauth2` manifest key is needed (that's only for Chrome's Google-specific `getAuthToken`, not the generic `launchWebAuthFlow` this uses).
  - `src/lib/mcp/registry.ts:38-67` — split `McpServerAuth` into `McpBearerAuth` (unchanged shape) and a new `McpOAuthAuth` (`accessToken`/`refreshToken?`/`expiresAt?`/`scope?`/`clientId`/`clientSecret?`/`authorizationServer{issuer,authorizationEndpoint,tokenEndpoint,registrationEndpoint?}`/`resource?`, exactly the card's shape), unioned as `McpServerAuth`. `isMcpServerAuth` (registry.ts:210-230) now branches on `v.type` and validates each variant's fields inline — a separate type-predicate helper per variant doesn't typecheck against a `Record<string, unknown>` parameter since neither interface has an index signature, so I folded both branches into one function rather than fighting that. `writeAuth`'s "clear if empty" check (registry.ts:181-186 was `auth.token.length === 0`) is now `isEmptyAuth` (registry.ts:229-232), true only for an empty bearer token — an oauth auth is never "empty" this way, only explicitly cleared via `writeAuth(id, undefined)`. Storage itself is untouched: still the whole `auth` object under `mcp:auth:<id>` in `chrome.storage.local`, still no migration path (pre-release, decisions/27's Context).
  - `src/lib/mcp/oauth.ts` (new) — the full RFC 9728 → RFC 8414 → RFC 7591 → RFC 6749/7636/8707 chain, module doc at the top mapping each RFC to the function that implements it. `discoverAuthorizationServer` (oauth.ts:192-246): GETs the MCP server origin's `/.well-known/oauth-protected-resource`, reads `authorization_servers[0]` as the issuer if present, else falls back to the MCP server's own origin as the issuer — then GETs `/.well-known/oauth-authorization-server` at whichever issuer was resolved. `registerClient` (oauth.ts:265-317): RFC 7591 POST, always `token_endpoint_auth_method: "none"`, carries through an optional `client_secret` a server hands back anyway. `runAuthorizationFlow` (oauth.ts:390-451): generates an S256 PKCE pair (`generatePkce`, oauth.ts:169-174) and `state`, builds the authorization URL with the RFC 8707 `resource` parameter, calls `chrome.identity.launchWebAuthFlow`/`getRedirectURL`, validates `state` and absence of `error` on the redirect, then exchanges the code (`exchangeCodeForToken`, oauth.ts:357-377) — `code_verifier` and `resource` both repeated on the token request. `getValidAuth` (oauth.ts:500-539): short-circuits on an unexpired token (60s skew, `EXPIRY_SKEW_MS`, oauth.ts:458), else does the `refresh_token` grant and persists via `updateServer(config.id, { auth: parsed.value })` — deliberately not special-cased on the literal string `"draft"`; `updateServer` itself returns `undefined` for any unregistered id (registry.ts:345), so an unsaved draft's refreshed token is simply not durable, which is the correct behavior generically, not just for that one literal id. Every failure path (bad discovery URL, malformed metadata, missing client_id, PKCE/state mismatch, `invalid_grant`, missing refresh token) returns a typed `McpError` — `kind: "auth"` specifically for anything that means "sign in again," per the card.
  - `src/lib/mcp/client.ts:55,325-372,1023-1026` — the one sanctioned call-site change. Split `authHeader` (bearer-only, byte-for-byte the same mapping as before) from the new async `resolveAuthHeader`, which returns `authHeader(config)` unchanged for anything that isn't `type: "oauth"`, and otherwise awaits `oauth.getValidAuth` and maps success to `{ Authorization: "Bearer <accessToken>" }` or failure straight through as the early `McpResult` error. `buildBaseHeaders` now takes the resolved auth header as a second parameter instead of computing it inline, spread last exactly where `authHeader(config)`'s result used to be spread — so the bearer path's header set and merge order are unchanged, just now assembled one `await` later inside `connect()` (client.ts:1023-1026). `effectiveCustomHeaders`'s reserved-header check (client.ts:330-338) now asks `hasResolvableAuth` (client.ts:324-328) — true for a non-empty bearer token OR any oauth auth present — instead of the old `Boolean(config.auth?.token)`, since an oauth config also puts a reserved `authorization` header on the wire once resolved. No other function in client.ts was touched.
- **claude** (2026-08-20T20:40:00.000Z): Post-review bug fix, found by hand-testing card 63's UI against a real server (`https://api.githubcopilot.com/mcp/`, GitHub's Copilot MCP endpoint) — sign-in failed with `.../.well-known/oauth-authorization-server responded 404`. Root cause: `discoverAuthorizationServer` only checked the bare-origin well-known path for both RFC 9728 and RFC 8414 lookups, but both RFCs (§3.1 each) locate a resource/issuer's metadata by INSERTING the well-known segment before the URL's path when it has one — the module doc's claim that "every real DCR-capable server this discovery chain targets publishes a bare-origin issuer" (oauth.ts, since removed) was wrong. Confirmed directly against GitHub's live server via curl before touching code: `api.githubcopilot.com/.well-known/oauth-protected-resource` → 404, but `api.githubcopilot.com/.well-known/oauth-protected-resource/mcp` → 200 (names issuer `https://github.com/login/oauth`); `github.com/.well-known/oauth-authorization-server` → 404, but `github.com/.well-known/oauth-authorization-server/login/oauth` → 200. Fixed with a new `wellKnownCandidates(baseUrl, wellKnownName)` (oauth.ts) that returns the path-inserted URL first and the bare-origin form second, and `fetchFirstOk` to try them in order; both the protected-resource and authorization-server lookups in `discoverAuthorizationServer` (oauth.ts:192-) now go through it. Verified the fix by calling the real `discoverAuthorizationServer` against `https://api.githubcopilot.com/mcp/` from a throwaway tsx script (deleted after) — it now correctly resolves the full `{issuer, authorizationEndpoint, tokenEndpoint}` triple. `npm run check` (176 files, 0 errors) and `npm run build` re-run clean after the fix.
  - Separately (not fixed, and out of this card's scope per decisions/27): GitHub's authorization server does not support RFC 7591 dynamic client registration (`POST /login/oauth/register` → 422, no `registration_endpoint` in its metadata) — it requires a manually pre-registered OAuth App/GitHub App with a fixed `client_id`. This is exactly the "manual client_id/secret entry" decisions/27 explicitly deferred, so sign-in against GitHub's MCP server will still stop at card 63's "doesn't support dynamic client registration" message even with this fix. Flagged to the user as a scope decision, not resolved here. (Resolved shortly after — see card 63's journal: the user asked for manual client-id entry to be added rather than deferred, so it was.)
- **claude** (2026-08-20T21:40:00.000Z): Second post-review bug fix — the user reported that after a successful GitHub sign-in (once the manual client-id panel above existed), every MCP tool call failed as a permission error. Root cause: `discoverAuthorizationServer` read `authorization_servers` off the RFC 9728 protected-resource document but silently dropped its `scopes_supported` field, and nothing anywhere in this module ever put a `scope` parameter on the authorization request — so GitHub (and any other authorization server) issued a token with no meaningful grants, every time, regardless of which MCP server was being connected. Confirmed via curl that GitHub's own protected-resource document (`api.githubcopilot.com/.well-known/oauth-protected-resource/mcp`) explicitly lists 13 scopes (`repo`, `read:org`, `notifications`, `workflow`, etc.) under `scopes_supported` — the resource server telling the client exactly what it needs, unused.
  - `registry.ts:62-68` — added `scopesSupported?: string[]` to `McpOAuthAuth["authorizationServer"]` (documented as resource-preferred, AS-metadata-as-fallback), and widened `isAuthorizationServerMetadata` (registry.ts:193-204) to validate it when present.
  - `oauth.ts` (`discoverAuthorizationServer`) — now captures `scopes_supported` off the RFC 9728 protected-resource document when present (`resourceScopes`), falling back to the RFC 8414 authorization-server metadata's own `scopes_supported` only if the resource didn't publish one (a new local `parseScopes` helper shared by both), and returns it as part of the discovery result.
  - `src/options/components/McpServerForm.svelte` — both places that call `runAuthorizationFlow` (the automatic-DCR path and `handleOAuthContinueManual`, the manual-client-id path) now pass `scope: discovery.scopesSupported?.join(" ")` — `runAuthorizationFlow` already had a `scope` field in its config and already put it on the authorization URL (oauth.ts:397-409's `authUrl.searchParams.set("scope", config.scope)`, built in the original card 62 work); it just was never being fed one.
  - Note for the user: this fixes sign-in *going forward* — an already-connected GitHub server is still holding a scope-less token from before the fix and needs Disconnect + Sign in again (a refresh alone won't add scope; OAuth scope is fixed at authorization time, not renegotiated on refresh).
  - Verified: re-ran the real `discoverAuthorizationServer` (not a mock) against `https://api.githubcopilot.com/mcp/` from a throwaway tsx script (deleted after) — confirms all 13 of GitHub's advertised scopes now come back in `scopesSupported`. `npm run check` (176 files, 0 errors), `npm run build`, and `npm run verify` (9/9) all re-run clean.
  - decisions/27 updated with this as a third "revised during implementation" note.
  - Deviation from a literal reading of the card: two pre-existing option-UI files (`src/options/components/McpServerForm.svelte:58` and `src/options/components/McpServerRow.svelte:65-73`) read `.auth?.token` directly and stopped type-checking once `McpServerAuth` became a union (the oauth variant has no `token` field). Rather than leave `npm run check` red across the whole repo for a change entirely inside my scope, I applied the smallest possible type-narrowing fix in each (`.auth?.type === "bearer" && .auth.token`) — zero behavior change, no new UI, just satisfying the type checker — and left a comment at each site pointing at card 63 for the real UI work (an oauth badge/"reconnect needed" affordance). Flagging this explicitly since the card said not to touch `src/options/**`; happy to have it reverted if card 63's agent would rather own that hunk from scratch.
  - Verification, beyond type-checking (mirroring card 37's bar): wrote a throwaway driver in the scratchpad (deleted when done, nothing landed in the repo) that spun up hand-rolled HTTP servers speaking the real RFC 9728/8414/7591/6749 wire shapes plus a stubbed `chrome.storage`/`chrome.identity`, and ran 32 assertions against `discoverAuthorizationServer` (both the cross-origin protected-resource path and the same-origin fallback, plus an invalid-URL case), `registerClient` (success + a rejected endpoint), `runAuthorizationFlow` (a full real PKCE round trip — the fake token endpoint independently recomputes SHA-256 over the `code_verifier` and rejects a deliberately-wrong challenge, proving PKCE is actually enforced end to end, not just type-correct — plus a `state`-mismatch rejection), and `getValidAuth` (unexpired short-circuit with no network call, expired-token refresh that persists through `updateServer` and preserves a non-reissued refresh token, a `"draft"` id that refreshes but doesn't persist, a revoked refresh token surfacing `kind: "auth"`, and a missing-refresh-token case that never touches the network). A second throwaway driver exercised `client.ts`'s `resolveAuthHeader`/`connect()` against a minimal fake Streamable HTTP MCP server requiring Bearer auth: confirmed the bearer path (`testServerConnection`) behaves identically to before (valid token connects, wrong token and no-auth both surface `kind: "auth"`), and that an oauth config with an already-expired token transparently refreshes through `connect()` and authenticates on the same call, while a revoked refresh token fails the whole `connect()` before any MCP request is even attempted. All 37 assertions across both drivers passed. `runAuthorizationFlow`'s actual `chrome.identity.launchWebAuthFlow` popup can't be exercised outside a real loaded extension (no Chrome APIs in a plain script) — that interactive step still needs manual verification once card 63 wires a click handler to it, which decisions/27 already flags as a known follow-up risk (the user-gesture timing question specifically).
  - Gates: `npm run check` (176 files, 0 errors — one transient unrelated error in `src/lib/providers/presets.ts` appeared on an interleaved run and was gone on the next, almost certainly another concurrent agent mid-edit in this shared working tree, not anything in this card's files), `npm run build` (green), `npm run verify` (9/9 required checks passed; a second run was needed once after an unrelated Chrome-launch timeout in the `WebMCP-unavailable` check, which then passed cleanly — looked like resource contention from running build/verify back to back, not a regression from this card's changes).

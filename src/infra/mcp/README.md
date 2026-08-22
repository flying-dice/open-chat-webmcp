# infra/mcp

The HTTP MCP client and its OAuth 2.1 flow — everything that speaks MCP protocol `2025-06-18` over Streamable HTTP (with legacy SSE fallback) to a remote server, plus the discovery/registration/sign-in/refresh chain those servers increasingly require.

Landed in card 76 from `src/lib/mcp/client.ts` (1,294 lines) and `src/lib/mcp/oauth.ts` (602), split by concern rather than kept as two big files:

| File | What it owns |
| --- | --- |
| `index.ts` | the barrel: `createMcpToolGateway`, `createMcpOAuthClient`, and the protocol/timeout constants |
| `protocol.ts` | `PROTOCOL_VERSION`, `SUPPORTED_PROTOCOL_VERSIONS`, and `DEFAULT_CLIENT_INFO` (from the build, not from `package.json`) |
| `timeouts.ts` | the whole budget ladder: CONNECT 10s / LIST 10s / DISCOVERY 12s / CALL 30s / OAUTH 10s |
| `budget.ts` | one `AbortController`-backed budget per call — the per-server failure isolation decisions/14 requires |
| `json-rpc.ts` | JSON-RPC envelopes, and every mapping from an HTTP status or a JSON-RPC `error` into `McpError` |
| `sse.ts` | chunk-boundary-safe SSE framing, shared by both transports |
| `session.ts` | `McpWireSession` (never exported past `index.ts`) and `initialize` result validation |
| `headers.ts` | decisions/15's reserved-header safety net, the bearer header, and the oauth header resolved through `McpTokenResolver` |
| `streamable-http.ts` | the modern transport |
| `legacy-sse.ts` | the deprecated 2024-11-05 transport, kept for backwards compatibility |
| `connect.ts` | transport selection: auth first, modern next, legacy only on the spec's 404/405 signal |
| `results.ts` | `tools/list` pagination and `tools/call` content normalization |
| `gateway.ts` | `McpToolGateway`: `testServerConnection`, `listServerTools`, `callServerTool`, `discoverAllServerTools` |
| `oauth-http.ts` | the metadata GET and the form-encoded token POST, and their error mapping |
| `oauth-metadata.ts` | RFC 9728/8414 discovery and RFC 7591 dynamic registration |
| `oauth.ts` | `McpOAuthClient`: PKCE, `runAuthorizationFlow` (the only `chrome.identity` site), and `getValidAuth`'s refresh |

## What this adapter needs from outside

Exactly two things, both injected at construction and neither looked up:

- `McpOAuthClient` takes an **`McpAuthTokenStore`** (`src/domain/tools`) — the write-only port a refreshed token goes out through. This is what dissolves the `oauth → registry` inversion decisions/29 named: the transport stack no longer mutates the config store from inside itself, and `src/infra/mcp` has no import edge to `src/infra/chrome-storage` at all (`adapters-do-not-import-adapters` in `.dependency-cruiser.cjs` would fail if it did).
- `McpToolGateway` takes an **`McpTokenResolver`** — the narrow half of `McpOAuthClient`, so the transport depends on token refresh and never on the interactive sign-in flow.

Nothing here reads `package.json`: the `clientInfo` announced in the handshake comes from the `__APP_NAME__`/`__APP_VERSION__` build-time `define` (`vite.config.ts`, typed in `src/build-globals.d.ts`), and any gateway may override it.

## The rules this folder keeps

Every function that crosses the boundary resolves the shared `Result<T, McpError>` tuple (`src/domain/result.ts`, decisions/34-errors-as-values.md) and throws for nothing — including a storage failure while persisting a refreshed token, which is swallowed as best-effort rather than turned into a failed request. `McpError` lives in `src/domain/tools`; nothing in `src/domain/*` ever sees a `DOMException`, an HTTP status, or a `fetch` rejection. Card 94 retired the bespoke `McpResult` record shape onto that shared tuple, and also widened `McpError` with four OAuth-specific kinds the flow used to fold into generic ones: `discovery-absent`, `registration-rejected`, `refresh-expired`, `user-cancelled`.

Only a composition root constructs what lives here (`src/sidepanel/main.ts`, `src/options/main.ts`). Card 78 deleted the interim per-surface wiring modules that used to share that job and made `only-roots-construct-infra` enforce it.

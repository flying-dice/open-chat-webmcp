---
column: todo
labels: [backend, infra]
priority: high
updatedAt: 2026-08-22T13:15:00.000Z
---
# MCP infrastructure behind ports

Move the HTTP MCP stack into `src/infra/mcp` and dissolve its two layering
inversions, per decisions/29-ddd-hexagonal-typescript-layout.md and the
adapter/port rules in `.claude/skills/ddd-hexagonal/SKILL.md`.
`src/lib/mcp/client.ts` is the largest file in the repo (1294 lines): protocol
2025-06-18 over Streamable HTTP plus the legacy SSE transport, a never-throws
`McpResult` contract, timeouts CONNECT 10s / LIST 10s / DISCOVERY 12s / CALL 30s,
4 fetch sites — and it imports `package.json` for its version string.
`src/lib/mcp/oauth.ts` (602 lines, 3 fetch + 6 `chrome.identity` sites) implements
OAuth 2.1 + PKCE discovery (RFC 9728/8414), dynamic registration (RFC 7591) and
`getValidAuth` refresh, but imports `updateServer` from `./registry` — the
transport stack writing the config store. Both concerns become adapters behind
ports that `domain/tools` owns and `src/sidepanel/services/mcpTools.ts` (239)
consumes.

## Checklist

- [ ] `src/lib/mcp/client.ts` → `src/infra/mcp`: both transports, the never-throws `McpResult` contract and the CONNECT/LIST/DISCOVERY/CALL timeout set move unchanged; `testServerConnection`, `listServerTools`, `callServerTool`, `discoverAllServerTools` keep their behaviour
- [ ] `src/lib/mcp/oauth.ts` → `src/infra/mcp`: discovery, dynamic registration, `runAuthorizationFlow` and `getValidAuth` keep behaviour, and all 6 `chrome.identity` sites stay inside infra
- [ ] `oauth.ts` no longer imports `updateServer` from the registry — refreshed tokens persist through an injected `McpAuthTokenStore` port declared in `domain/tools` and implemented by the chrome-storage adapter (`mcp:auth:<id>`)
- [ ] `client.ts` stops importing `package.json` — the client version is injected at construction, sourced from a build-time `define` in vite.config.ts (or read from the generated manifest)
- [ ] `domain/tools` declares the `McpToolGateway` / `McpDiscovery` port interfaces (list, call, discover-all, test-connection); `src/sidepanel/services/mcpTools.ts` and the options test-connection helpers depend on those interfaces, never on the client module
- [ ] the `McpError` union and `describeMcpError` (already in `domain/tools`) are the only error shape crossing out of `src/infra/mcp` — no HTTP status or fetch rejection leaks
- [ ] `npm run guard:boundaries` shows no `infra/mcp` → `infra/chrome-storage` edge: the token store arrives by injection from the composition root
- [ ] npm run check, npm run build, npm run guard and npm run verify green

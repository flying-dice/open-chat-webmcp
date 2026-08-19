---
column: review
labels: [backend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T21:40:00.000Z
---
# MCP server registry and remote client

"As a user I should be able to add custom MCP servers from backend MCPs so that I
can integrate with tools not in the current UI."

Implements the transport and storage half of
decisions/14-backend-mcp-servers.md. Cards 38 (merging into the loop) and 39 (the
management UI) build on this.

Remote transports only — streamable HTTP and SSE. No stdio, no helper process; a
browser extension cannot spawn a subprocess. Local stdio servers are reached via
an off-the-shelf proxy the user runs, which we document rather than ship.

Follow the shape the provider registry already established
(decisions/10-provider-registry-and-credential-storage.md): configs in
`chrome.storage.sync`, credentials and custom header values in
`chrome.storage.local`, never-throw result types, host access via
`chrome.permissions.request` from a user gesture.

Per-server failure isolation is a hard requirement: one slow or dead server must
never stop the page's own tools from being offered.

## Checklist

- [x] MCP client over streamable HTTP + SSE, partial-event safe like the OpenAI client
- [x] Initialize/handshake, `tools/list`, `tools/call` with typed results
- [x] Server config type + registry CRUD, mirroring the provider registry
- [x] Optional auth and custom headers (decisions/15-custom-headers-are-credentials.md)
- [x] Host permission request flow per server
- [x] Per-server timeout and failure isolation; never block page tools
- [x] Named error kinds — unreachable, auth, protocol mismatch — not bare strings

## Gates

- [x] check — npm run check: 144 files, 0 errors (claude, 2026-08-19T21:40:00.000Z)
- [x] build — npm run build green (claude, 2026-08-19T21:40:00.000Z)
- [x] verify — npm run verify: 9/9 required checks passed (claude, 2026-08-19T21:40:00.000Z)

## Comments

- **claude** (2026-08-19T21:40:00.000Z): Implemented the transport+storage half of decisions/14-backend-mcp-servers.md entirely under a new `src/lib/mcp/` — did not touch `src/lib/provider.ts`, `src/lib/providers/**`, `src/options/**`, or any other owned-by-others path per the card's isolation instructions.
  - `src/lib/mcp/types.ts` — `McpError`/`McpResult` (never-throw, mirrors `src/lib/provider.ts`'s `ProviderError`/`ProviderResult`), `McpTool`/`McpToolCallResult`/content-item types, `McpServerDiscovery`.
  - `src/lib/mcp/registry.ts` — `McpServerConfig` CRUD (`listServers`/`getServer`/`addServer`/`updateServer`/`removeServer`/`reorderServers`), mirroring `src/lib/providers/registry.ts:1-320` closely. Storage split: everything but `auth`/`headers` in `chrome.storage.sync` under `mcp:servers:list`; `auth.token` in `chrome.storage.local` under `mcp:auth:<id>`; the whole `headers` map (decisions/15: values are credentials) in `chrome.storage.local` under `mcp:headers:<id>` — kept as one map per server rather than split key-by-key, a more conservative reading of decision 15. `validateServerHeaders` (registry.ts:112-136) is exported for card 39 to refuse reserved-header conflicts (`content-type`, `accept`, and `authorization` when a token is set) visibly at edit time; the client also strips them defensively as a safety net.
  - `src/lib/mcp/permissions.ts` — host-permission request/check, a near-verbatim local copy of `src/options/lib/permissions.ts`'s already-URL-generic logic (that file is off-limits, owned by concurrent options work) — flagged in the report as something that should collapse into one shared helper later.
  - `src/lib/mcp/client.ts` — the handshake/`tools/list`/`tools/call` client. Targets protocol version `2025-06-18`, verified directly against the spec's lifecycle/transports/tools pages (not guessed) rather than assumed from training knowledge. Implements both remote transports: modern Streamable HTTP (`tryStreamableHttp`, client.ts:635-732) and the deprecated HTTP+SSE transport kept for backwards compatibility (`LegacySsePump` + `connectLegacySse`, client.ts:767-975), auto-detected per the spec's documented fallback trigger (POST 404/405) unless a config pins one transport. Every exported call (`testServerConnection`, `listServerTools`, `callServerTool`) is a self-contained connect-do-one-thing-close round trip — no persistent session object a caller can leak. Timeouts are a deliberate, separate budget from the existing bridge(20s)/relay(25s)/worker(30s)/panel(35s) cross-context ladder (documented at client.ts:92-118): connect/list get 10s (12s per-server inside discovery), `tools/call` gets 30s, chosen to sit near that ladder's outermost worker rung since a remote tool call is comparable in kind to a page tool call. `discoverAllServerTools` (client.ts:1260) is the failure-isolation entry point card 38 will use: `Promise.all` over a never-throwing per-server call, each with its own `AbortController`-backed budget, so one dead/slow server degrades to one `status:"error"` entry instead of blocking or rejecting the batch.
  - Verified the SSE parser is chunk-boundary-safe by fabricating payloads split at up to *every single byte* (173-way split) in the scratchpad, and verified the whole handshake against a real `@modelcontextprotocol/sdk` server over real sockets (streamable HTTP, session ids, a Bearer-auth 401 path, `tools/list`/`tools/call` including an `isError:true` tool result and an unknown-tool call) — see the report for the full breakdown; none of that test tooling is part of the shipped module.

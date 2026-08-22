// `tools` bounded context (decisions/29-ddd-hexagonal-typescript-layout.md):
// the tool descriptor vocabulary, the MCP error/result vocabulary, and the
// merge algebra that turns a page's WebMCP tools plus every connected MCP
// server's tools into the ONE namespaced list a model sees.
//
// Card 74 added the configured-server side (./servers.ts): what an
// `McpServerConfig` is, which of its fields are credentials, the
// reserved-header rule, and the `McpServerRegistry` driven port — the
// servers whose tools ./merge.ts merges.
//
// Card 76 added the OPERATION ports (./gateway.ts): `McpToolGateway` (test/
// list/call/discover) and `McpOAuthClient` (RFC 9728/8414 discovery, RFC
// 7591 registration, the PKCE flow, token refresh), plus ./servers.ts's
// `McpAuthTokenStore` — the write-only port a refreshed token goes through
// so the transport stack never touches the config store itself. Their one
// implementation is the `src/infra/mcp` adapter; no surface names that
// module, only these interfaces.
//
// Pure TypeScript — no `chrome.*`, no `fetch`, no DOM, no Svelte. The WebMCP
// page bridge that also FEEDS this context is an adapter (src/infra/webmcp)
// and lands in cards 77-79; the `chrome.storage` implementation of
// `McpServerRegistry` already lives in src/infra/chrome-storage.
//
// This barrel is the context's public face: other contexts and the outer
// layers import `src/domain/tools`, never a file inside it.

export * from "./tool";
export * from "./types";
export * from "./merge";
export * from "./servers";
export * from "./gateway";

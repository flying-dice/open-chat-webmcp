// `tools` bounded context (decisions/29-ddd-hexagonal-typescript-layout.md):
// the tool descriptor vocabulary, the MCP error/result vocabulary, and the
// merge algebra that turns a page's WebMCP tools plus every connected MCP
// server's tools into the ONE namespaced list a model sees.
//
// Pure TypeScript — no `chrome.*`, no `fetch`, no DOM, no Svelte. The HTTP
// MCP client and the WebMCP page bridge that FEED this context are adapters
// (src/infra/mcp, src/infra/webmcp) and land here in cards 74-79.
//
// This barrel is the context's public face: other contexts and the outer
// layers import `src/domain/tools`, never a file inside it.

export * from "./tool";
export * from "./types";
export * from "./merge";

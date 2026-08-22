# infra/mcp — placeholder

The HTTP MCP client and its OAuth 2.1 flow — everything that speaks MCP protocol `2025-06-18` over Streamable HTTP (with legacy SSE fallback) to a remote server.

| Lands here | Comes from |
| --- | --- |
| `testServerConnection`, `listServerTools`, `callServerTool`, `discoverAllServerTools`, both transports and the timeout ladder | `src/lib/mcp/client.ts` (1,294 lines) |
| RFC 9728/8414 discovery, RFC 7591 dynamic registration, the PKCE authorization flow and token refresh | `src/lib/mcp/oauth.ts` (602 lines) |

The `oauth → registry` write (the transport stack mutating the config store
from inside itself, noted in decisions/29) is dissolved on the way: token
persistence goes through a port, not a direct call into another adapter.
The `McpError`/`McpResult` vocabulary these map into already lives in
`src/domain/tools`.

Adapters map their technology's failures INTO the domain's error vocabulary;
nothing in `src/domain/*` ever sees a `DOMException`, an HTTP status, or
`chrome.runtime.lastError`. Only a composition root
(`src/sidepanel/main.ts`, `src/options/main.ts`, `src/background/sw.ts`)
constructs what lives here.

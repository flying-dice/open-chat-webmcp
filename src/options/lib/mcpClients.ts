// INTERIM WIRING (card 76) — the options-page twin of
// src/sidepanel/lib/mcpClients.ts; read that file's header for the full
// rationale (it mirrors ./providerClients.ts and
// src/infra/chrome-storage/wiring.ts).
//
// Unlike the side panel, this surface uses the WHOLE `McpOAuthClient`:
// McpServerForm.svelte drives discovery, dynamic registration and the
// interactive sign-in flow from a click handler (card 63), and
// ./mcpTestConnection.ts drives the gateway's `discoverAllServerTools` for
// "Test connection". Both still see only the port interfaces from
// src/domain/tools — this file is the only place on this surface that names
// src/infra/mcp.

import { createMcpOAuthClient, createMcpToolGateway } from "../../infra/mcp";
import { mcpAuthTokenStore } from "../../infra/chrome-storage";

/** OAuth 2.1 + PKCE against remote MCP servers: discovery, dynamic registration, the PKCE sign-in flow, and token refresh. */
export const mcpOAuthClient = createMcpOAuthClient({ tokenStore: mcpAuthTokenStore });

/** Test/list/call/discover against remote MCP servers, with oauth configs resolved through {@link mcpOAuthClient}. */
export const mcpToolGateway = createMcpToolGateway({ auth: mcpOAuthClient });

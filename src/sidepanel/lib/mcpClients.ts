// INTERIM WIRING (card 76, the same shortcut as ./providerClients.ts and
// src/infra/chrome-storage/wiring.ts — read either of those headers for the
// full rationale).
//
// Card 76 moved the HTTP MCP client and its OAuth flow into src/infra/mcp
// behind `McpToolGateway`/`McpOAuthClient` (src/domain/tools). Both are now
// CONSTRUCTED rather than imported as free functions, because both take a
// dependency: the OAuth client takes the token store its refresh writes
// through, and the gateway takes that OAuth client as its token resolver.
// This file is where those two lines happen for the side panel's bundle.
//
// Why a module-level export rather than threading it through: the one caller
// here (src/sidepanel/services/mcpTools.ts) takes no dependencies at all, the
// same situation cards 74 and 75 found. Real injection is card 77/78's UI
// work — `ui-does-not-import-infra` in .dependency-cruiser.cjs is parked for
// exactly them.
//
// HOW A LATER CARD DELETES THIS: once mcpTools.ts takes its gateway as an
// argument, src/sidepanel/main.ts builds these two lines itself from the
// bundle `initChromeStorage()` already hands it, and passes them down; this
// file loses its last importer.
//
// The side panel never signs anyone in (that is the options page's job), so
// it uses `mcpOAuthClient` only for `getValidAuth`'s token refresh — but it
// is the same object either way, and `McpTokenResolver` is what the gateway
// asks for.

import { createMcpOAuthClient, createMcpToolGateway } from "../../infra/mcp";
import { mcpAuthTokenStore } from "../../infra/chrome-storage";

/** OAuth 2.1 + PKCE against remote MCP servers, refreshing tokens back into this surface's storage ports. */
export const mcpOAuthClient = createMcpOAuthClient({ tokenStore: mcpAuthTokenStore });

/** Test/list/call/discover against remote MCP servers, with oauth configs resolved through {@link mcpOAuthClient}. */
export const mcpToolGateway = createMcpToolGateway({ auth: mcpOAuthClient });

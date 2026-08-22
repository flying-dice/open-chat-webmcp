// `mcp` adapter (card 76, decisions/29, decisions/14, decisions/27) — see
// ./README.md for the file-by-file map.
//
// Two factories, and nothing else worth importing from outside:
//
//   createMcpOAuthClient({ tokenStore })  ->  McpOAuthClient
//   createMcpToolGateway({ auth })        ->  McpToolGateway
//
// Both port interfaces live in src/domain/tools; a service or component
// imports the TYPE from there and receives the instance from its surface's
// wiring (src/sidepanel/lib/mcpClients.ts, src/options/lib/mcpClients.ts),
// never from this barrel. Only a composition root or that interim wiring
// imports this file.

export { createMcpToolGateway, type McpToolGatewayOptions } from "./gateway";
export { createMcpOAuthClient, type McpOAuthClientOptions } from "./oauth";
export { DEFAULT_CLIENT_INFO, PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS, type McpClientInfo } from "./protocol";
export {
  DEFAULT_CALL_TOOL_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DEFAULT_LIST_TOOLS_TIMEOUT_MS,
  OAUTH_REQUEST_TIMEOUT_MS,
} from "./timeouts";

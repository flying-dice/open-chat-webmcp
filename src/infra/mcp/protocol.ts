// Which MCP protocol this adapter speaks, and who it says it is (card 76;
// moved unchanged from src/lib/mcp/client.ts apart from where the client
// version comes from — see {@link DEFAULT_CLIENT_INFO}).
//
// Protocol version targeted: "2025-06-18" (the current spec at
// https://modelcontextprotocol.io/specification/2025-06-18/), verified
// against the spec's lifecycle page rather than guessed.

/** The protocol version this client requests in `initialize`, and always the first entry of {@link SUPPORTED_PROTOCOL_VERSIONS}. */
export const PROTOCOL_VERSION = "2025-06-18";

/**
 * Versions this client accepts when a server negotiates down (spec: "If the
 * server supports the requested protocol version, it MUST respond with the
 * same version. Otherwise, the server MUST respond with another protocol
 * version it supports... If the client does not support the version in the
 * server's response, it SHOULD disconnect"). `tools/list`/`tools/call`'s
 * wire shape is unchanged across all three, so accepting the two prior
 * versions costs nothing and covers servers that haven't upgraded yet.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

/** What this client calls itself in the `initialize` handshake's `clientInfo`. */
export interface McpClientInfo {
  name: string;
  version: string;
}

/**
 * The default `clientInfo`, from the BUILD rather than from a runtime import
 * (card 76).
 *
 * `src/lib/mcp/client.ts` used to `import pkg from "../../../package.json"`,
 * which made an adapter reach outside `src/` for build metadata and pulled
 * the whole manifest into the bundle for two strings. `__APP_NAME__` and
 * `__APP_VERSION__` are Vite `define` substitutions (vite.config.ts, typed in
 * src/build-globals.d.ts) filled from the same package.json manifest.config.ts
 * already reads — so the wire value is identical, it is now a literal in the
 * output, and package.json stops being a runtime dependency of the transport.
 *
 * Any gateway may still override it (`createMcpToolGateway`'s `clientInfo`
 * option), which is what makes a test able to pin the handshake's identity
 * without a build.
 */
export const DEFAULT_CLIENT_INFO: McpClientInfo = {
  name: __APP_NAME__,
  version: __APP_VERSION__,
};

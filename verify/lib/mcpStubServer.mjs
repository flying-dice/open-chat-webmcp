// A tiny, REAL MCP server over Streamable HTTP (src/infra/mcp/streamable-http.ts,
// /specification/2025-06-18/basic/transports) for verify/checks/inspectorScenario.mjs
// (card 112). Not a fixture object, not a stubbed `fetch` — a genuine
// `node:http` listener the extension's real MCP client connects to over a
// real socket on `127.0.0.1`, the same reasoning verify/lib/demoServer.mjs
// already applies to the WebMCP demo page: "does MCP discovery actually
// round-trip through this extension's real client" is not answerable by
// asserting against a fixture object.
//
// WHY THIS EXISTS RATHER THAN REUSING src/infra/testing/http-test-server.ts.
// That module is `.test.ts`-only (imports Vitest's `beforeEach`/`afterEach`
// directly, and is excluded from `.dependency-cruiser.cjs` on exactly that
// basis) — it cannot be imported from a no-build `verify/` script. This file
// is the `verify/`-side equivalent: same "real node:http, no mocked fetch"
// idea, sized to the one MCP conversation the inspector scenario needs
// (`initialize` -> `notifications/initialized` -> `tools/list`) rather than a
// general-purpose route table.
//
// SCOPE, DELIBERATELY MINIMAL. One POST route, JSON responses only (no SSE
// framing — src/infra/mcp/streamable-http.ts accepts a plain
// `application/json` reply to `initialize`/`tools/list` per spec, and that is
// the simpler of the two paths the real client already handles). No auth, no
// pagination, no `tools/call` — the inspector scenario only needs discovery
// to complete and the tool to be LISTED with its origin, never to actually
// run it.

import { createServer } from "node:http";

/** What the real client's `initialize` needs back — see src/infra/mcp/session.ts's `validateInitializeResult`. */
const PROTOCOL_VERSION = "2025-06-18";

/**
 * @param {{name: string, tools: {name: string, description: string, annotations?: Record<string, unknown>}[]}} options
 *   `name` is the server's own `serverInfo.name` — this is NOT the display
 *   name the options page stores (`McpServerConfigCore.name`, set by whoever
 *   registers the server); it only has to exist for `initialize` to validate.
 * @returns {Promise<{baseUrl: string, close: () => Promise<void>, requests: string[]}>}
 */
export async function startMcpStubServer({ name, tools }) {
  /** @type {string[]} JSON-RPC methods received, oldest first — evidence a real discovery round trip happened, not just that the server came up. */
  const requests = [];

  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let msg;
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "parse error" },
          }),
        );
        return;
      }
      requests.push(msg.method);

      if (msg.method === "notifications/initialized") {
        // A notification carries no `id` and expects no body back.
        res.writeHead(202).end();
        return;
      }
      if (msg.method === "initialize") {
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name },
            },
          }),
        );
        return;
      }
      if (msg.method === "tools/list") {
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id ?? null,
          error: { code: -32601, message: `stub does not implement "${msg.method}"` },
        }),
      );
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/`;

  return {
    baseUrl,
    requests,
    close() {
      return new Promise((resolve) => server.close(() => resolve(undefined)));
    },
  };
}

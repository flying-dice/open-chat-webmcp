// Tests for `createMcpToolGateway` — the four operations end to end over a
// stubbed `fetch` (card 88, boards/project-backlog/88-close-remaining-test-gaps.md).
// gateway.ts wires connect.ts/results.ts together itself rather than taking
// them as injected dependencies, so these are full-stack tests through the
// streamable-http transport; connect.test.ts/streamable-http.test.ts/
// legacy-sse.test.ts already cover transport SELECTION and the wire-level
// fault matrix in isolation.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../domain/result";
import type { McpError, McpServerConfig, McpTokenResolver } from "../../domain/tools";
import { createMcpToolGateway } from "./gateway";
import { jsonResponse } from "../testing/fetch-stub";

afterEach(() => {
  vi.unstubAllGlobals();
});

const noopAuth: McpTokenResolver = {
  async getValidAuth(): Promise<Result<never, McpError>> {
    throw new Error("not an oauth config in these tests");
  },
};

function serverConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "s1",
    name: "Server",
    url: "https://mcp.example/rpc",
    enabled: true,
    transport: "auto",
    ...overrides,
  };
}

function initOk(): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id: 1,
    result: { protocolVersion: "2025-06-18", serverInfo: { name: "srv" } },
  });
}

/** A minimal, well-behaved streamable-http server: initialize, then answers any request with `handle`. */
function stubServer(handle: (method: string, params: unknown) => unknown) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as {
      id?: number;
      method: string;
      params?: unknown;
    };
    if (body.method === "initialize") return initOk();
    if (body.method === "notifications/initialized") return jsonResponse({ ok: true });
    return jsonResponse({ jsonrpc: "2.0", id: body.id, result: handle(body.method, body.params) });
  });
}

describe("createMcpToolGateway", () => {
  describe("testServerConnection", () => {
    it("resolves the negotiated connection and closes the session (no lingering request after)", async () => {
      const fetchMock = stubServer(() => ({}));
      vi.stubGlobal("fetch", fetchMock);
      const gateway = createMcpToolGateway({ auth: noopAuth });

      const result = await gateway.testServerConnection(serverConfig());

      expect(result).toEqual([
        {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "srv" },
          instructions: undefined,
        },
        undefined,
      ]);
    });

    it("propagates a connect failure untouched", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("boom", { status: 500 })),
      );
      const gateway = createMcpToolGateway({ auth: noopAuth });

      const [, error] = await gateway.testServerConnection(serverConfig());
      expect(error).toBeDefined();
    });
  });

  describe("listServerTools", () => {
    it("returns the server's normalized tool list", async () => {
      const fetchMock = stubServer((method) => {
        if (method === "tools/list") return { tools: [{ name: "search" }, { name: "fetch" }] };
        return {};
      });
      vi.stubGlobal("fetch", fetchMock);
      const gateway = createMcpToolGateway({ auth: noopAuth });

      const [value, error] = await gateway.listServerTools(serverConfig());
      if (error) throw error;
      expect(value.map((t) => t.name)).toEqual(["search", "fetch"]);
    });

    it("a connect failure short-circuits before tools/list is ever attempted", async () => {
      const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
      vi.stubGlobal("fetch", fetchMock);
      const gateway = createMcpToolGateway({ auth: noopAuth });

      // transport pinned to streamable-http so a 404 fails outright rather than falling back to legacy.
      const [, error] = await gateway.listServerTools(
        serverConfig({ transport: "streamable-http" }),
      );
      expect(error).toBeDefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("callServerTool", () => {
    it("invokes the named tool with its arguments and returns the decoded result", async () => {
      const fetchMock = stubServer((method, params) => {
        if (method === "tools/call") {
          const { name, arguments: args } = params as {
            name: string;
            arguments: Record<string, unknown>;
          };
          return {
            content: [{ type: "text", text: `called ${name} with ${JSON.stringify(args)}` }],
          };
        }
        return {};
      });
      vi.stubGlobal("fetch", fetchMock);
      const gateway = createMcpToolGateway({ auth: noopAuth });

      const result = await gateway.callServerTool(serverConfig(), "search", { q: "cats" });
      expect(result).toEqual([
        {
          content: [{ type: "text", text: 'called search with {"q":"cats"}' }],
          structuredContent: undefined,
          isError: false,
        },
        undefined,
      ]);
    });
  });

  describe("discoverAllServerTools", () => {
    it("per-server failure isolation: one dead server never affects another's successful result (decisions/14)", async () => {
      const good = serverConfig({
        id: "good",
        name: "Good Server",
        url: "https://good.example/rpc",
      });
      const bad = serverConfig({ id: "bad", name: "Bad Server", url: "https://bad.example/rpc" });

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit) => {
          if (url.startsWith("https://bad.example")) throw new TypeError("Failed to fetch");
          const body = JSON.parse(init.body as string) as { id?: number; method: string };
          if (body.method === "initialize") return initOk();
          if (body.method === "notifications/initialized") return jsonResponse({ ok: true });
          return jsonResponse({
            jsonrpc: "2.0",
            id: body.id,
            result: { tools: [{ name: "onlyTool" }] },
          });
        }),
      );
      const gateway = createMcpToolGateway({ auth: noopAuth });

      const results = await gateway.discoverAllServerTools([good, bad]);

      expect(results).toEqual([
        {
          status: "ok",
          serverId: "good",
          serverName: "Good Server",
          connection: {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "srv" },
            instructions: undefined,
          },
          tools: [
            {
              name: "onlyTool",
              title: undefined,
              description: undefined,
              inputSchema: undefined,
              outputSchema: undefined,
              annotations: undefined,
            },
          ],
        },
        {
          status: "error",
          serverId: "bad",
          serverName: "Bad Server",
          error: { kind: "unreachable", message: expect.any(String) },
        },
      ]);
    });

    it("an empty server list resolves to an empty result list, never throws", async () => {
      vi.stubGlobal("fetch", vi.fn());
      const gateway = createMcpToolGateway({ auth: noopAuth });
      await expect(gateway.discoverAllServerTools([])).resolves.toEqual([]);
    });

    it("a server whose tools/list result is malformed contributes an error entry, not a thrown exception", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          const body = JSON.parse(init.body as string) as { id?: number; method: string };
          if (body.method === "initialize") return initOk();
          if (body.method === "notifications/initialized") return jsonResponse({ ok: true });
          return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { notTools: [] } }); // missing `tools`
        }),
      );
      const gateway = createMcpToolGateway({ auth: noopAuth });

      const results = await gateway.discoverAllServerTools([serverConfig()]);
      expect(results).toEqual([
        {
          status: "error",
          serverId: "s1",
          serverName: "Server",
          error: { kind: "invalid-response", message: expect.any(String) },
        },
      ]);
    });
  });
});

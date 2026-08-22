// Tests for `tryStreamableHttp` and the session it builds — the MODERN
// transport (card 88, boards/project-backlog/88-close-remaining-test-gaps.md).
// Covers the initialize handshake's happy/fault paths and the chaos case the
// card calls out by name: a 401 arriving mid-tool-call, after the connect
// handshake already succeeded (token expiry between connect and call).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "../../domain/tools";
import { createBudget } from "./budget";
import { DEFAULT_CLIENT_INFO } from "./protocol";
import { tryStreamableHttp } from "./streamable-http";
import { jsonResponse } from "../testing/fetch-stub";

afterEach(() => {
  vi.unstubAllGlobals();
});

const clientInfo = DEFAULT_CLIENT_INFO;

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

function initOk(extra?: Record<string, unknown>): Response {
  return jsonResponse(
    {
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "srv" } },
    },
    extra ? { headers: { "Content-Type": "application/json", ...extra } } : undefined,
  );
}

describe("tryStreamableHttp", () => {
  it("happy path: connects, sends notifications/initialized, and resolves the negotiated connection", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => initOk());
    vi.stubGlobal("fetch", fetchMock);
    const budget = createBudget(1000, undefined);

    const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
    budget.cleanup();

    expect(attempt.outcome).toBe("connected");
    if (attempt.outcome !== "connected") return;
    expect(attempt.session.connection).toEqual({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "srv" },
      instructions: undefined,
    });
    // initialize + notifications/initialized
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondInit = fetchMock.mock.calls[1]![1] as RequestInit;
    const secondBody = JSON.parse(secondInit.body as string);
    expect(secondBody).toMatchObject({ method: "notifications/initialized" });
  });

  it("carries a server-issued Mcp-Session-Id header on every subsequent request", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", "Mcp-Session-Id": "sess-abc" },
          },
        );
      }
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: {} });
    });
    vi.stubGlobal("fetch", fetchMock);
    const budget = createBudget(1000, undefined);

    const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
    if (attempt.outcome !== "connected") throw new Error("expected connected");
    await attempt.session.request("tools/list");
    budget.cleanup();

    const lastInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    expect((lastInit.headers as Record<string, string>)["Mcp-Session-Id"]).toBe("sess-abc");
  });

  it("request() ids increment starting at 2 (id 1 was the initialize)", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === "initialize") return initOk();
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { echoedId: body.id } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const budget = createBudget(1000, undefined);
    const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
    if (attempt.outcome !== "connected") throw new Error("expected connected");

    const first = await attempt.session.request("tools/list");
    const second = await attempt.session.request("tools/list");
    budget.cleanup();

    expect(first).toEqual({ ok: true, value: { echoedId: 2 } });
    expect(second).toEqual({ ok: true, value: { echoedId: 3 } });
  });

  describe("connect-time faults", () => {
    it("401 fails as kind 'auth', carrying the status and a safe message", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ error: { code: -32000, message: "Token expired" } }), {
              status: 401,
            }),
        ),
      );
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt).toEqual({
        outcome: "failed",
        error: { kind: "auth", status: 401, message: "Token expired" },
      });
    });

    it("403 also fails as kind 'auth'", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("forbidden", { status: 403 })),
      );
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
      if (attempt.outcome !== "failed") return;
      expect(attempt.error.kind).toBe("auth");
    });

    it("transport 'auto': 404 signals try-legacy rather than failing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("not found", { status: 404 })),
      );
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(
        serverConfig({ transport: "auto" }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      expect(attempt).toEqual({ outcome: "try-legacy" });
    });

    it("transport 'streamable-http' (pinned): the SAME 404 fails outright instead", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("not found", { status: 404 })),
      );
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(
        serverConfig({ transport: "streamable-http" }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
    });

    it("an ordinary 500 fails with a classified HTTP error, not try-legacy", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("server error", { status: 500 })),
      );
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(
        serverConfig({ transport: "auto" }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
      if (attempt.outcome !== "failed") return;
      expect(attempt.error.kind).toBe("not-mcp-endpoint");
    });

    it("a 2xx with an unrecognized content type fails as not-mcp-endpoint", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("<html>hi</html>", {
              status: 200,
              headers: { "Content-Type": "text/html" },
            }),
        ),
      );
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt).toEqual({
        outcome: "failed",
        error: {
          kind: "not-mcp-endpoint",
          message: 'Unexpected content type "text/html" from the MCP endpoint.',
        },
      });
    });

    it("a JSON content type with a body that isn't valid JSON fails as not-mcp-endpoint", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("{not json", {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
        ),
      );
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
      if (attempt.outcome !== "failed") return;
      expect(attempt.error.kind).toBe("not-mcp-endpoint");
    });

    it("valid JSON that isn't a JSON-RPC envelope fails as not-mcp-endpoint", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse({ hello: "world" })),
      );
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
      if (attempt.outcome !== "failed") return;
      expect(attempt.error.kind).toBe("not-mcp-endpoint");
    });

    it("an SSE content type with no body fails as not-mcp-endpoint", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(null, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
        ),
      );
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt).toEqual({
        outcome: "failed",
        error: { kind: "not-mcp-endpoint", message: "SSE response had no body." },
      });
    });

    it("an SSE response whose initialize result fails validation surfaces that failure, not a generic one", async () => {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            enc.encode(
              `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "not-a-real-version" } })}\n\n`,
            ),
          );
          controller.close();
        },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
        ),
      );
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
      if (attempt.outcome !== "failed") return;
      expect(attempt.error.kind).toBe("protocol-mismatch");
    });

    it("a network error (fetch throws) is classified via the budget, not left as a raw exception", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
      );
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
      if (attempt.outcome !== "failed") return;
      expect(attempt.error.kind).toBe("unreachable");
    });
  });

  describe("session.request() faults after a successful connect", () => {
    it("a malformed JSON-RPC envelope on an in-session request is invalid-response", async () => {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (body.method === "initialize") return initOk();
        return jsonResponse({ not: "a json-rpc envelope" });
      });
      vi.stubGlobal("fetch", fetchMock);
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      if (attempt.outcome !== "connected") throw new Error("expected connected");

      const result = await attempt.session.request("tools/list");
      budget.cleanup();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("invalid-response");
    });

    it("an unexpected content type on an in-session request is invalid-response", async () => {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (body.method === "initialize") return initOk();
        return new Response("plain text", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      if (attempt.outcome !== "connected") throw new Error("expected connected");

      const result = await attempt.session.request("tools/list");
      budget.cleanup();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("invalid-response");
    });

    it("notify() is best-effort — a failing POST doesn't throw or surface", async () => {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (body.method === "initialize") return initOk();
        throw new TypeError("Failed to fetch");
      });
      vi.stubGlobal("fetch", fetchMock);
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      if (attempt.outcome !== "connected") throw new Error("expected connected");

      // notifications/initialized already fired as part of connecting and
      // failed silently — connecting itself must still have succeeded.
      await expect(attempt.session.notify("some/notification")).resolves.toBeUndefined();
      budget.cleanup();
    });

    it("close() is a no-op for this transport — safe to call, nothing to release", async () => {
      const fetchMock = vi.fn(async () => initOk());
      vi.stubGlobal("fetch", fetchMock);
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      if (attempt.outcome !== "connected") throw new Error("expected connected");
      expect(() => attempt.session.close()).not.toThrow();
    });
  });

  describe("chaos: 401 mid-tool-call — the access token expires between connect and call", () => {
    it("a request that succeeded to connect but then gets a 401 on the very next call surfaces kind 'auth', not a generic failure", async () => {
      let toolCallCount = 0;
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (body.method === "initialize") return initOk();
        if (body.method === "tools/call") {
          toolCallCount++;
          return new Response(
            JSON.stringify({ error: { code: -32000, message: "Access token expired" } }),
            { status: 401 },
          );
        }
        return jsonResponse({ jsonrpc: "2.0", id: body.id, result: {} });
      });
      vi.stubGlobal("fetch", fetchMock);
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      if (attempt.outcome !== "connected") throw new Error("expected connected");

      // The handshake succeeded fully (protocol negotiated, notified) — the
      // token then goes stale before the very next call on the SAME session.
      const result = await attempt.session.request("tools/call", { name: "doTheThing" });
      budget.cleanup();

      expect(toolCallCount).toBe(1);
      expect(result).toEqual({
        ok: false,
        error: { kind: "auth", status: 401, message: "Access token expired" },
      });
    });

    it("a 403 mid-call is classified the same way as a 401 mid-call", async () => {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (body.method === "initialize") return initOk();
        return new Response("forbidden", { status: 403 });
      });
      vi.stubGlobal("fetch", fetchMock);
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(serverConfig(), {}, clientInfo, budget);
      if (attempt.outcome !== "connected") throw new Error("expected connected");

      const result = await attempt.session.request("tools/call", { name: "doTheThing" });
      budget.cleanup();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("auth");
    });
  });
});

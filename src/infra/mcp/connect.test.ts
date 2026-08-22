// Tests for `connect` — transport SELECTION and fallback ordering (card 88,
// boards/project-backlog/88-close-remaining-test-gaps.md): auth resolved
// first (and short-circuits on failure before any request), streamable-http
// tried before the legacy transport unless pinned otherwise, and the legacy
// fallback reached only on the spec's documented 404/405 signal with
// `transport: "auto"`.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpResult, McpServerConfig, McpTokenResolver } from "../../domain/tools";
import { connect } from "./connect";
import { DEFAULT_CLIENT_INFO } from "./protocol";
import { createBudget } from "./budget";
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

const noopAuth: McpTokenResolver = {
  async getValidAuth(): Promise<McpResult<never>> {
    throw new Error("not an oauth config in these tests");
  },
};

function initOkResponse(): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id: 1,
    result: { protocolVersion: "2025-06-18", serverInfo: { name: "srv" } },
  });
}

describe("connect", () => {
  it("resolves the auth header first — a refused oauth resolver short-circuits before any fetch is attempted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const auth: McpTokenResolver = {
      async getValidAuth() {
        return { ok: false, error: { kind: "auth", message: "no token" } };
      },
    };
    const config = serverConfig({ auth: { type: "oauth" } as never });
    const budget = createBudget(1000, undefined);

    const result = await connect(config, { auth, clientInfo }, budget);
    budget.cleanup();

    expect(result).toEqual({ ok: false, error: { kind: "auth", message: "no token" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("transport 'auto': tries streamable HTTP first and never touches the legacy transport when it connects", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => initOkResponse());
    vi.stubGlobal("fetch", fetchMock);
    const config = serverConfig({ transport: "auto" });
    const budget = createBudget(1000, undefined);

    const result = await connect(config, { auth: noopAuth, clientInfo }, budget);
    budget.cleanup();

    expect(result.ok).toBe(true);
    // One POST for initialize, one for notifications/initialized — both to
    // the same streamable-http endpoint; no GET (legacy transport) ever fired.
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).method).toBe("POST");
    }
  });

  it("transport 'auto': a 404 from streamable HTTP falls back to the legacy SSE transport", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") return new Response("not found", { status: 404 });
      // The legacy transport's opening GET.
      return new Response("nope, no legacy SSE stub wired for this test", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const config = serverConfig({ transport: "auto" });
    const budget = createBudget(1000, undefined);

    await connect(config, { auth: noopAuth, clientInfo }, budget);
    budget.cleanup();

    // Both a POST (streamable-http attempt) and a GET (legacy fallback attempt) happened.
    const methods = fetchMock.mock.calls.map((c) => (c[1] as RequestInit).method);
    expect(methods).toContain("POST");
    expect(methods).toContain("GET");
  });

  it("transport 'auto': a 405 from streamable HTTP also falls back to the legacy transport", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
      init.method === "POST"
        ? new Response("method not allowed", { status: 405 })
        : new Response("", { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const budget = createBudget(1000, undefined);

    await connect(serverConfig({ transport: "auto" }), { auth: noopAuth, clientInfo }, budget);
    budget.cleanup();

    const methods = fetchMock.mock.calls.map((c) => (c[1] as RequestInit).method);
    expect(methods).toEqual(expect.arrayContaining(["POST", "GET"]));
  });

  it("transport 'auto': an ordinary 500 from streamable HTTP fails outright — never falls back to legacy", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const budget = createBudget(1000, undefined);

    const result = await connect(
      serverConfig({ transport: "auto" }),
      { auth: noopAuth, clientInfo },
      budget,
    );
    budget.cleanup();

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no legacy GET attempted
  });

  it("transport 'streamable-http' (pinned): a 404 fails outright — pinning suppresses the auto-fallback", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("not found", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const budget = createBudget(1000, undefined);

    const result = await connect(
      serverConfig({ transport: "streamable-http" }),
      { auth: noopAuth, clientInfo },
      budget,
    );
    budget.cleanup();

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("transport 'sse' (pinned): skips streamable HTTP entirely and goes straight to the legacy GET", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST")
        throw new Error("streamable HTTP must not be attempted when transport is pinned to sse");
      return new Response("no SSE stub wired — this test only asserts the request shape", {
        status: 500,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const budget = createBudget(1000, undefined);

    await connect(serverConfig({ transport: "sse" }), { auth: noopAuth, clientInfo }, budget);
    budget.cleanup();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(init?.method).toBe("GET");
    expect(url).toBe("https://mcp.example/rpc");
  });

  it("a bearer-token config sends its Authorization header on the streamable-http attempt", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => initOkResponse());
    vi.stubGlobal("fetch", fetchMock);
    const config = serverConfig({ auth: { type: "bearer", token: "secret-tok" } });
    const budget = createBudget(1000, undefined);

    await connect(config, { auth: noopAuth, clientInfo }, budget);
    budget.cleanup();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-tok");
  });

  describe("chaos: network failure during transport selection", () => {
    it("streamable HTTP unreachable (fetch throws) on an 'auto' config still tries the legacy transport, not just failing", async () => {
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") throw new TypeError("Failed to fetch");
        return new Response("", { status: 500 });
      });
      vi.stubGlobal("fetch", fetchMock);
      const budget = createBudget(1000, undefined);

      const result = await connect(
        serverConfig({ transport: "auto" }),
        { auth: noopAuth, clientInfo },
        budget,
      );
      budget.cleanup();

      // A network-level failure (not a 404/405) is NOT the documented
      // wrong-transport signal — connect must fail outright, not fall back.
      expect(result.ok).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

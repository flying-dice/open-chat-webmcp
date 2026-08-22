// Tests for `connect` — transport SELECTION and fallback ordering (card 88,
// boards/project-backlog/88-close-remaining-test-gaps.md): auth resolved
// first (and short-circuits on failure before any request), streamable-http
// tried before the legacy transport unless pinned otherwise, and the legacy
// fallback reached only on the spec's documented 404/405 signal with
// `transport: "auto"`.
//
// Card 111 (boards/project-backlog/111-realistic-adapter-tests.md): the
// fallback tests now run against a REAL `node:http` server serving BOTH the
// streamable-http POST endpoint (404/405) and the legacy SSE GET endpoint —
// proving the fallback really does reach a working second transport, not
// just that a second `fetch` call happened. The resolved-auth-header test is
// ported too, for the same real-header-casing reason ../ollama and
// ../openai's suites port theirs. The pure "auth resolution short-circuits
// before any fetch" test stays on the stub — there is no wire behaviour to
// be more real about when the point is that `fetch` is never called at all.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../domain/result";
import type { McpError, McpServerConfig, McpTokenResolver } from "../../domain/tools";
import { connect } from "./connect";
import { DEFAULT_CLIENT_INFO } from "./protocol";
import { createBudget } from "./budget";
import type { RouteContext } from "../testing/http-test-server";
import { destroySocket, useHttpTestServer, writeChunks } from "../testing/http-test-server";

/** `RouteContext["res"]` — structurally `node:http`'s `ServerResponse`, referenced this way (rather than importing `node:http` directly) because this program's `tsconfig.app.json` has no `"node"` entry in `types` (a pre-existing gap in ../testing/http-test-server.ts itself, out of this card's scope). */
type Res = RouteContext["res"];

afterEach(() => {
  vi.unstubAllGlobals();
});

const clientInfo = DEFAULT_CLIENT_INFO;
const enc = new TextEncoder();
const server = useHttpTestServer();

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
  async getValidAuth(): Promise<Result<never, McpError>> {
    throw new Error("not an oauth config in these tests");
  },
};

/** Parses an incoming request's JSON-RPC body — every real-server route below needs `method`/`id` to answer differently per call. */
function parsedBody(body: RouteContext["body"]): { id?: number; method: string } {
  return JSON.parse(body.toString());
}

describe("connect", () => {
  // KEPT: the point of this test is that `fetch` is NEVER called — a real
  // server can't make that assertion any sharper than a spy that must stay
  // uncalled.
  it("resolves the auth header first — a refused oauth resolver short-circuits before any fetch is attempted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const auth: McpTokenResolver = {
      async getValidAuth() {
        return [undefined, { kind: "auth", message: "no token" }];
      },
    };
    const config = serverConfig({ auth: { type: "oauth" } as never });
    const budget = createBudget(1000, undefined);

    const result = await connect(config, { auth, clientInfo }, budget);
    budget.cleanup();

    expect(result).toEqual([undefined, { kind: "auth", message: "no token" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // PORTED: a real streamable-http handshake against a real server; the
  // legacy transport's GET endpoint is deliberately left unregistered, so a
  // fallback attempt would surface as a real 404 from THIS server rather
  // than a mock that was simply never called.
  it("transport 'auto': tries streamable HTTP first and never touches the legacy transport when it connects", async () => {
    server().route("POST", "/rpc", ({ res, body }) => {
      const msg = parsedBody(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      if (msg.method === "initialize") {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { protocolVersion: "2025-06-18", serverInfo: { name: "srv" } },
          }),
        );
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id ?? null, result: {} }));
    });
    const config = serverConfig({ url: `${server().baseUrl}/rpc`, transport: "auto" });
    const budget = createBudget(1000, undefined);

    const result = await connect(config, { auth: noopAuth, clientInfo }, budget);
    budget.cleanup();

    const [, error] = result;
    expect(error).toBeUndefined();
    // One POST for initialize, one for notifications/initialized — both to
    // the same streamable-http endpoint; no GET (legacy transport) ever fired.
    expect(server().requests.every((r) => r.method === "POST")).toBe(true);
    expect(server().requests).toHaveLength(2);
  });

  // PORTED (card 111 calls this out by name): a real streamable-http 404,
  // then a real legacy SSE handshake completing on the SAME server — proving
  // the fallback reaches an actually-working second transport, not just that
  // a second `fetch` call happened.
  it("transport 'auto': a 404 from streamable HTTP falls back to the legacy SSE transport, which completes for real", async () => {
    server().route("POST", "/rpc", ({ res }) => {
      res.writeHead(404);
      res.end("not found");
    });
    let sseRes: Res | undefined;
    server().route("GET", "/rpc", async ({ res }) => {
      sseRes = res;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      await writeChunks(res, [enc.encode("event: endpoint\ndata: /session/abc\n\n")], {
        end: false,
      });
    });
    server().route("POST", "/session/abc", async ({ res, body }) => {
      const msg = parsedBody(body);
      if (msg.method === "initialize" && sseRes) {
        await writeChunks(
          sseRes,
          [
            enc.encode(
              `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } })}\n\n`,
            ),
          ],
          { end: false },
        );
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const config = serverConfig({ url: `${server().baseUrl}/rpc`, transport: "auto" });
    const budget = createBudget(1000, undefined);

    const [session, error] = await connect(config, { auth: noopAuth, clientInfo }, budget);
    budget.cleanup();

    expect(error).toBeUndefined();
    session?.close();
    // The failed streamable-http POST, the legacy GET, and the legacy POSTs
    // (initialize + notifications/initialized) all really happened.
    const methods = server().requests.map((r) => r.method);
    expect(methods).toContain("POST");
    expect(methods).toContain("GET");
    expect(methods.filter((m) => m === "POST").length).toBeGreaterThanOrEqual(3);
  });

  // PORTED: same real fallback signal, a real 405 this time.
  it("transport 'auto': a 405 from streamable HTTP also falls back to the legacy transport, which completes for real", async () => {
    server().route("POST", "/rpc", ({ res }) => {
      res.writeHead(405);
      res.end("method not allowed");
    });
    let sseRes: Res | undefined;
    server().route("GET", "/rpc", async ({ res }) => {
      sseRes = res;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      await writeChunks(res, [enc.encode("event: endpoint\ndata: /session/abc\n\n")], {
        end: false,
      });
    });
    server().route("POST", "/session/abc", async ({ res, body }) => {
      const msg = parsedBody(body);
      if (msg.method === "initialize" && sseRes) {
        await writeChunks(
          sseRes,
          [
            enc.encode(
              `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } })}\n\n`,
            ),
          ],
          { end: false },
        );
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const budget = createBudget(1000, undefined);

    const [session, error] = await connect(
      serverConfig({ url: `${server().baseUrl}/rpc`, transport: "auto" }),
      { auth: noopAuth, clientInfo },
      budget,
    );
    budget.cleanup();

    expect(error).toBeUndefined();
    session?.close();
    const methods = server().requests.map((r) => r.method);
    expect(methods).toEqual(expect.arrayContaining(["POST", "GET"]));
  });

  // PORTED: a real 500 — the documented signal is 404/405 ONLY, so this
  // proves the fallback genuinely does not fire for anything else, against a
  // real status the client actually reads off the wire.
  it("transport 'auto': an ordinary 500 from streamable HTTP fails outright — never falls back to legacy", async () => {
    server().route("POST", "/rpc", ({ res }) => {
      res.writeHead(500);
      res.end("boom");
    });
    const budget = createBudget(1000, undefined);

    const result = await connect(
      serverConfig({ url: `${server().baseUrl}/rpc`, transport: "auto" }),
      { auth: noopAuth, clientInfo },
      budget,
    );
    budget.cleanup();

    const [, error] = result;
    expect(error).toBeDefined();
    expect(server().requests).toHaveLength(1); // no legacy GET attempted
  });

  // PORTED: a real 404, pinned transport — the fallback is suppressed by
  // config, not by the status.
  it("transport 'streamable-http' (pinned): a 404 fails outright — pinning suppresses the auto-fallback", async () => {
    server().route("POST", "/rpc", ({ res }) => {
      res.writeHead(404);
      res.end("not found");
    });
    const budget = createBudget(1000, undefined);

    const result = await connect(
      serverConfig({ url: `${server().baseUrl}/rpc`, transport: "streamable-http" }),
      { auth: noopAuth, clientInfo },
      budget,
    );
    budget.cleanup();

    const [, error] = result;
    expect(error).toBeDefined();
    expect(server().requests).toHaveLength(1);
    expect(server().requests[0]?.method).toBe("POST");
  });

  // PORTED: pinning to "sse" must never even attempt the streamable-http
  // POST — proven for real by not registering a POST route at all, so
  // attempting one would surface as a real 404 rather than a thrown "must
  // not be attempted" assertion inside a mock.
  it("transport 'sse' (pinned): skips streamable HTTP entirely and goes straight to the legacy GET", async () => {
    server().route("GET", "/rpc", ({ res }) => {
      res.writeHead(500);
      res.end("no SSE stub wired — this test only asserts the request shape");
    });
    const budget = createBudget(1000, undefined);

    await connect(
      serverConfig({ url: `${server().baseUrl}/rpc`, transport: "sse" }),
      { auth: noopAuth, clientInfo },
      budget,
    );
    budget.cleanup();

    expect(server().requests).toHaveLength(1);
    expect(server().requests[0]?.method).toBe("GET");
    expect(server().requests[0]?.url).toBe("/rpc");
  });

  // PORTED: this is exactly the kind of thing a stubbed `Response` can't
  // prove — that the resolved bearer `Authorization` header really left the
  // client and really arrived, case-insensitively, on the server.
  it("a bearer-token config sends its Authorization header on the streamable-http attempt, against a real server", async () => {
    server().route("POST", "/rpc", ({ res, body }) => {
      const msg = parsedBody(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      if (msg.method === "initialize") {
        res.end(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }),
        );
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id ?? null, result: {} }));
    });
    const config = serverConfig({
      url: `${server().baseUrl}/rpc`,
      auth: { type: "bearer", token: "secret-tok" },
    });
    const budget = createBudget(1000, undefined);

    await connect(config, { auth: noopAuth, clientInfo }, budget);
    budget.cleanup();

    expect(server().requests[0]?.headers.authorization).toBe("Bearer secret-tok");
  });

  describe("chaos: network failure during transport selection", () => {
    // PORTED, with a corrected title: the original stub test's name
    // ("...still tries the legacy transport, not just failing") directly
    // contradicted its own assertion (`fetchMock).toHaveBeenCalledTimes(1)`),
    // which already proved the legacy transport was NEVER attempted — a
    // pre-existing copy/paste mistake in the title, not a behavior bug. The
    // real `connect.ts` code confirms the assertion was right all along:
    // `tryStreamableHttp`'s `outcome: "failed"` branch (connect.ts, the
    // `if (attempt.outcome === "failed") return fail(attempt.error);` line)
    // returns immediately on ANY failure, including a network error — only
    // the SPECIFIC `outcome: "try-legacy"` case (a 404/405 on `"auto"`) ever
    // reaches the legacy transport at all. Fixed the title to match what the
    // test actually (and correctly) asserts.
    it("a real network failure (not 404/405) is not the documented wrong-transport signal — connect fails outright without ever attempting the legacy fallback", async () => {
      // A real abrupt connection reset (not a hand-thrown TypeError) is what
      // makes `fetch()` itself reject here — the genuine network-failure path,
      // same distinction ../ollama and ../openai's chaos suites make between
      // a clean close and a forcible one.
      server().route("POST", "/rpc", ({ res }) => {
        destroySocket(res);
      });
      const budget = createBudget(1000, undefined);

      const result = await connect(
        serverConfig({ url: `${server().baseUrl}/rpc`, transport: "auto" }),
        { auth: noopAuth, clientInfo },
        budget,
      );
      budget.cleanup();

      const [, error] = result;
      expect(error).toBeDefined();
      // Only the failed POST happened — no legacy GET was ever attempted.
      expect(server().requests).toHaveLength(1);
      expect(server().requests[0]?.method).toBe("POST");
    });
  });
});

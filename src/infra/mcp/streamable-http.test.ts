// Tests for `tryStreamableHttp` and the session it builds — the MODERN
// transport (card 88, boards/project-backlog/88-close-remaining-test-gaps.md).
// Covers the initialize handshake's happy/fault paths and the chaos case the
// card calls out by name: a 401 arriving mid-tool-call, after the connect
// handshake already succeeded (token expiry between connect and call).
//
// Card 111 (boards/project-backlog/111-realistic-adapter-tests.md): most of
// this suite now runs against a REAL `node:http` server
// (../testing/http-test-server.ts) instead of a hand-built `Response` over a
// stubbed `fetch` — a real initialize/notify round trip, a real
// `Mcp-Session-Id` header actually crossing the wire, real single-response SSE
// framing (chunk-boundary split, a leading comment/heartbeat line, CRLF line
// endings), and a real `AbortController` torn down against a real socket.
// Exactly one case (a 200 with `response.body === null`) stays on the
// fetch-stub — see its own note below for why no real server can produce
// that shape. Ported vs. kept is noted per test; see the card's journal for
// the summary.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "../../domain/tools";
import { createBudget } from "./budget";
import { DEFAULT_CLIENT_INFO } from "./protocol";
import { tryStreamableHttp } from "./streamable-http";
import type { RouteContext } from "../testing/http-test-server";
import { startHttpTestServer, useHttpTestServer, writeChunks } from "../testing/http-test-server";

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

/** `config.url` pointed at the real test server's bare origin — `tryStreamableHttp` fetches `config.url` directly with no path appended, and a bare origin's URL parses to path `"/"`, which is what every route below registers against. */
function realConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return serverConfig({ url: server().baseUrl, ...overrides });
}

/**
 * Parses the body of an incoming request as JSON-RPC — every real-server
 * route below needs to read `method`/`id` to answer initialize vs. a
 * subsequent call differently. Typed via `RouteContext["body"]` (structurally
 * `Buffer`) rather than naming `Buffer` directly — this program's
 * `tsconfig.app.json` has no `"node"` entry in `types` (a pre-existing gap in
 * ../testing/http-test-server.ts itself, out of this card's scope), so a bare
 * `Buffer` identifier here would be its own unrelated type error.
 */
function parsedBody(body: RouteContext["body"]): { id?: number; method: string } {
  return JSON.parse(body.toString());
}

describe("tryStreamableHttp", () => {
  // PORTED: proves the real initialize + notifications/initialized round
  // trip — two genuinely separate POSTs over one real connection, not two
  // calls into the same stubbed `fetch` mock.
  it("happy path: connects, sends notifications/initialized, and resolves the negotiated connection, against a real server", async () => {
    server().route("POST", "/", ({ res, body }) => {
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
    const budget = createBudget(1000, undefined);

    const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
    budget.cleanup();

    expect(attempt.outcome).toBe("connected");
    if (attempt.outcome !== "connected") return;
    expect(attempt.session.connection).toEqual({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "srv" },
      instructions: undefined,
    });
    expect(server().requests).toHaveLength(2);
    const methods = server().requests.map((r) => parsedBody(r.body).method);
    expect(methods).toEqual(["initialize", "notifications/initialized"]);
  });

  // PORTED: this is exactly the kind of thing a stubbed `Response` can't
  // prove — that `Mcp-Session-Id` really left the client as a header (not
  // just something the code intended to set) and really arrived on the
  // server. Node lowercases header names on receipt (RFC 7230 §3.2: header
  // names are case-insensitive), so `.headers["mcp-session-id"]` is the
  // honest shape to assert, same convention as ../ollama and ../openai's
  // ported suites.
  it("carries a server-issued Mcp-Session-Id header on every subsequent request, against a real server", async () => {
    server().route("POST", "/", ({ res, body }) => {
      const msg = parsedBody(body);
      if (msg.method === "initialize") {
        res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "sess-abc" });
        res.end(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
    });
    const budget = createBudget(1000, undefined);

    const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
    if (attempt.outcome !== "connected") throw new Error("expected connected");
    await attempt.session.request("tools/list");
    budget.cleanup();

    const [initReq, ...rest] = server().requests;
    void initReq; // the initialize request predates the server handing out the session id — nothing to assert on it
    expect(rest.length).toBeGreaterThan(0);
    for (const r of rest) {
      expect(r.headers["mcp-session-id"]).toBe("sess-abc");
    }
  });

  // PORTED: same real handshake as the two tests above, folded in rather
  // than duplicating a whole extra server round trip.
  it("request() ids increment starting at 2 (id 1 was the initialize), against a real server", async () => {
    server().route("POST", "/", ({ res, body }) => {
      const msg = parsedBody(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      if (msg.method === "initialize") {
        res.end(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }),
        );
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echoedId: msg.id } }));
    });
    const budget = createBudget(1000, undefined);
    const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
    if (attempt.outcome !== "connected") throw new Error("expected connected");

    const first = await attempt.session.request("tools/list");
    const second = await attempt.session.request("tools/list");
    budget.cleanup();

    expect(first).toEqual([{ echoedId: 2 }, undefined]);
    expect(second).toEqual([{ echoedId: 3 }, undefined]);
  });

  describe("connect-time faults", () => {
    // PORTED: a real 401 with a JSON-RPC-shaped error body, straight off the wire.
    it("401 fails as kind 'auth', carrying the status and a safe message, against a real server", async () => {
      server().route("POST", "/", ({ res }) => {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: -32000, message: "Token expired" } }));
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt).toEqual({
        outcome: "failed",
        error: { kind: "auth", status: 401, message: "Token expired" },
      });
    });

    // PORTED: a real 403 with a plain-text body.
    it("403 also fails as kind 'auth'", async () => {
      server().route("POST", "/", ({ res }) => {
        res.writeHead(403);
        res.end("forbidden");
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
      if (attempt.outcome !== "failed") return;
      expect(attempt.error.kind).toBe("auth");
    });

    // PORTED: the spec's documented wrong-transport signal, a real 404.
    it("transport 'auto': 404 signals try-legacy rather than failing", async () => {
      server().route("POST", "/", ({ res }) => {
        res.writeHead(404);
        res.end("not found");
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(
        realConfig({ transport: "auto" }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      expect(attempt).toEqual({ outcome: "try-legacy" });
    });

    // PORTED: same real 404, pinned transport this time.
    it("transport 'streamable-http' (pinned): the SAME 404 fails outright instead", async () => {
      server().route("POST", "/", ({ res }) => {
        res.writeHead(404);
        res.end("not found");
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(
        realConfig({ transport: "streamable-http" }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
    });

    // PORTED: a real 500, proving classifyHttpErrorResponse's fallback path
    // (no JSON-RPC error body to parse) against a real status/statusText.
    it("an ordinary 500 fails with a classified HTTP error, not try-legacy", async () => {
      server().route("POST", "/", ({ res }) => {
        res.writeHead(500);
        res.end("server error");
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(
        realConfig({ transport: "auto" }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
      if (attempt.outcome !== "failed") return;
      expect(attempt.error.kind).toBe("not-mcp-endpoint");
    });

    // PORTED: a real Content-Type header the client actually has to read off the wire.
    it("a 2xx with an unrecognized content type fails as not-mcp-endpoint", async () => {
      server().route("POST", "/", ({ res }) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html>hi</html>");
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt).toEqual({
        outcome: "failed",
        error: {
          kind: "not-mcp-endpoint",
          message: 'Unexpected content type "text/html" from the MCP endpoint.',
        },
      });
    });

    // PORTED: real 200 body that fails JSON.parse.
    it("a JSON content type with a body that isn't valid JSON fails as not-mcp-endpoint", async () => {
      server().route("POST", "/", ({ res }) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{not json");
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
      if (attempt.outcome !== "failed") return;
      expect(attempt.error.kind).toBe("not-mcp-endpoint");
    });

    // PORTED: valid JSON, real wire, just not a JSON-RPC envelope.
    it("valid JSON that isn't a JSON-RPC envelope fails as not-mcp-endpoint", async () => {
      server().route("POST", "/", ({ res }) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ hello: "world" }));
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
      if (attempt.outcome !== "failed") return;
      expect(attempt.error.kind).toBe("not-mcp-endpoint");
    });

    // KEPT on the fetch-stub: `response.body === null` on a 200 is not a
    // shape a real HTTP response can produce over `fetch` — undici only ever
    // hands back `null` for a HEAD request or a 204/304 status, never for an
    // ordinary 200 with a genuinely empty body (that's still a real, if
    // immediately-closed, `ReadableStream`). This is defensive code for a
    // response shape no real MCP server can send; a hand-built `Response` is
    // the only way to exercise it at all.
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

    // PORTED: real SSE — the single-response case ../sse.ts's
    // `readSseForResponse` handles, streamed off a real socket.
    it("an SSE response whose initialize result fails validation surfaces that failure, not a generic one", async () => {
      server().route("POST", "/", ({ res }) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          `data: ${JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { protocolVersion: "not-a-real-version" },
          })}\n\n`,
        );
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
      if (attempt.outcome !== "failed") return;
      expect(attempt.error.kind).toBe("protocol-mismatch");
    });

    // PORTED: a genuinely dead server (nothing listening on the port
    // anymore) rather than a hand-thrown TypeError — the real ECONNREFUSED
    // path `fetch` takes, proving `budget.classify` handles undici's actual
    // rejection.
    it("a network error (fetch throws) is classified via the budget, not left as a raw exception", async () => {
      const dead = await startHttpTestServer();
      const baseUrl = dead.baseUrl;
      await dead.close(); // nothing listens on this port from here on
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(
        serverConfig({ url: baseUrl }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      expect(attempt.outcome).toBe("failed");
      if (attempt.outcome !== "failed") return;
      expect(attempt.error.kind).toBe("unreachable");
    });
  });

  // NEW (card 111 explicitly asks for the single-response SSE case's real
  // framing quirks): chunk boundaries, comment/heartbeat lines, and CRLF line
  // endings, none of which a hand-built `ReadableStream.enqueue()` can prove —
  // those chunks never left the JS heap, so a boundary chosen there is chosen
  // in JS-string-space, not real TCP-packet-space.
  describe("initialize via SSE — real SSE framing", () => {
    it("resolves from an SSE event split across a real chunk boundary", async () => {
      const eventText = `data: ${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-06-18" },
      })}\n\n`;
      const bytes = enc.encode(eventText);
      const splitAt = Math.floor(bytes.length / 2);
      server().route("POST", "/", async ({ res }) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        await writeChunks(res, [bytes.slice(0, splitAt), bytes.slice(splitAt)]);
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt.outcome).toBe("connected");
    });

    it("skips a leading comment/heartbeat line before the real event", async () => {
      server().route("POST", "/", ({ res }) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          `: keepalive\n\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { protocolVersion: "2025-06-18" },
          })}\n\n`,
        );
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt.outcome).toBe("connected");
    });

    it("handles a CRLF-terminated SSE event", async () => {
      server().route("POST", "/", ({ res }) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          `data: ${JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { protocolVersion: "2025-06-18" },
          })}\r\n\r\n`,
        );
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(attempt.outcome).toBe("connected");
    });
  });

  describe("session.request() faults after a successful connect", () => {
    // PORTED: the initialize handshake is real; only the SECOND response's
    // envelope shape is what's under test.
    it("a malformed JSON-RPC envelope on an in-session request is invalid-response", async () => {
      server().route("POST", "/", ({ res, body }) => {
        const msg = parsedBody(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        if (msg.method === "initialize") {
          res.end(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }),
          );
          return;
        }
        res.end(JSON.stringify({ not: "a json-rpc envelope" }));
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      if (attempt.outcome !== "connected") throw new Error("expected connected");

      const [, err] = await attempt.session.request("tools/list");
      budget.cleanup();
      expect(err?.kind).toBe("invalid-response");
    });

    it("an unexpected content type on an in-session request is invalid-response", async () => {
      server().route("POST", "/", ({ res, body }) => {
        const msg = parsedBody(body);
        if (msg.method === "initialize") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }),
          );
          return;
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("plain text");
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      if (attempt.outcome !== "connected") throw new Error("expected connected");

      const [, err] = await attempt.session.request("tools/list");
      budget.cleanup();
      expect(err?.kind).toBe("invalid-response");
    });

    // PORTED: connects for real, then the server is torn down entirely —
    // notify()'s POST hits a genuinely dead connection, not a hand-thrown
    // TypeError standing in for one. Uses its OWN dedicated server (rather
    // than the shared `server()` fixture) specifically so it can be closed
    // mid-test without racing `useHttpTestServer`'s own `afterEach` teardown
    // of the shared one.
    it("notify() is best-effort — a failing POST doesn't throw or surface", async () => {
      const dedicated = await startHttpTestServer();
      dedicated.route("POST", "/", ({ res, body }) => {
        const msg = parsedBody(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id ?? 1,
            result: { protocolVersion: "2025-06-18" },
          }),
        );
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(
        serverConfig({ url: dedicated.baseUrl }),
        {},
        clientInfo,
        budget,
      );
      if (attempt.outcome !== "connected") throw new Error("expected connected");

      // notifications/initialized already fired as part of connecting and
      // succeeded — NOW kill the server so this explicit notify() genuinely
      // cannot reach anything.
      await dedicated.close();
      await expect(attempt.session.notify("some/notification")).resolves.toBeUndefined();
      budget.cleanup();
    });

    it("close() is a no-op for this transport — safe to call, nothing to release", async () => {
      server().route("POST", "/", ({ res, body }) => {
        const msg = parsedBody(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id ?? 1,
            result: { protocolVersion: "2025-06-18" },
          }),
        );
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      budget.cleanup();
      if (attempt.outcome !== "connected") throw new Error("expected connected");
      expect(() => attempt.session.close()).not.toThrow();
    });
  });

  // PORTED (card 111 calls this out by name): both the 401 and 403
  // mid-tool-call chaos cases now run against a real server — the handshake
  // succeeds over one real connection, then the SAME connection's next
  // request gets a real 401/403.
  describe("chaos: 401 mid-tool-call — the access token expires between connect and call", () => {
    it("a request that succeeded to connect but then gets a 401 on the very next call surfaces kind 'auth', not a generic failure", async () => {
      let toolCallCount = 0;
      server().route("POST", "/", ({ res, body }) => {
        const msg = parsedBody(body);
        if (msg.method === "initialize") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }),
          );
          return;
        }
        if (msg.method === "tools/call") {
          toolCallCount++;
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: -32000, message: "Access token expired" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      if (attempt.outcome !== "connected") throw new Error("expected connected");

      // The handshake succeeded fully (protocol negotiated, notified) — the
      // token then goes stale before the very next call on the SAME session.
      const result = await attempt.session.request("tools/call", { name: "doTheThing" });
      budget.cleanup();

      expect(toolCallCount).toBe(1);
      expect(result).toEqual([
        undefined,
        { kind: "auth", status: 401, message: "Access token expired" },
      ]);
    });

    it("a 403 mid-call is classified the same way as a 401 mid-call", async () => {
      server().route("POST", "/", ({ res, body }) => {
        const msg = parsedBody(body);
        if (msg.method === "initialize") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }),
          );
          return;
        }
        res.writeHead(403);
        res.end("forbidden");
      });
      const budget = createBudget(1000, undefined);
      const attempt = await tryStreamableHttp(realConfig(), {}, clientInfo, budget);
      if (attempt.outcome !== "connected") throw new Error("expected connected");

      const [, err] = await attempt.session.request("tools/call", { name: "doTheThing" });
      budget.cleanup();
      expect(err?.kind).toBe("auth");
    });
  });

  // NEW (card 111 checklist: "Abort propagation asserted against real
  // sockets"). `budget.signal` is what every fetch in this transport is
  // signalled off (see ./budget.ts's doc comment) — abort it mid-handshake
  // and both sides of the wire must agree: the server sees the socket close,
  // and `budget.classify` maps the resulting `AbortError` to `kind: "aborted"`
  // (not "timeout" — the budget's own timer never fired).
  describe("real AbortController against a real socket", () => {
    it("aborting mid-handshake tears the connection down server-side and yields outcome 'failed' with kind 'aborted'", async () => {
      let requestArrived: () => void = () => undefined;
      const requestArrivedPromise = new Promise<void>((resolve) => {
        requestArrived = resolve;
      });
      let releaseServer: () => void = () => undefined;
      const serverSawClose = new Promise<void>((resolve) => {
        releaseServer = resolve;
      });
      server().route("POST", "/", ({ res }) => {
        // Confirm the server actually received the initialize request before
        // the test aborts — avoids a destroy racing the connection's own
        // establishment (same coordination pattern ../ollama and
        // ../openai's ported abort tests use). Never responds at all, so the
        // abort is what ends the connection, not a completed reply.
        requestArrived();
        res.once("close", () => releaseServer());
      });

      const controller = new AbortController();
      const budget = createBudget(5000, controller.signal);
      const attemptPromise = tryStreamableHttp(realConfig(), {}, clientInfo, budget);

      await requestArrivedPromise;
      controller.abort();
      const attempt = await attemptPromise;
      budget.cleanup();
      // The client-side promise resolving doesn't guarantee the server has
      // already observed the socket teardown — wait for its own 'close' event
      // before asserting the server-side flag, the same ordering ../ollama and
      // ../openai's ported abort tests use.
      await serverSawClose;

      expect(attempt).toEqual({ outcome: "failed", error: { kind: "aborted" } });
      expect(server().requests[0]?.aborted).toBe(true);
    });
  });
});

// Tests for `connectLegacySse` and the `LegacySsePump` it drives — the
// DEPRECATED HTTP+SSE transport's full lifecycle (card 88,
// boards/project-backlog/88-close-remaining-test-gaps.md): the GET stream ->
// endpoint event -> POSTed initialize -> matched response handshake, its
// fault paths, and the chaos case the card calls out: a 401 arriving
// mid-tool-call, after the handshake already succeeded.
//
// Card 111 (boards/project-backlog/111-realistic-adapter-tests.md): the WHOLE
// suite now runs against a REAL `node:http` server
// (../testing/http-test-server.ts) rather than a hand-built `ReadableStream`
// fed through a stubbed `fetch` — this transport's whole reason for existing
// is a long-lived SSE GET stream interleaved with POSTs that push more events
// onto it, which is exactly the shape a real server proves and a hand-rolled
// stream can only assert the JS-level intent of. Every test below pushes
// bytes over a real socket; there is no pure-classification test left in
// this file to keep on the stub (unlike ../ollama and ../openai's suites,
// which each keep a couple of pure JSON-envelope/cache tests). See each
// test's PORTED/NEW note for what specifically became real.
//
// A recurring shape below: the SSE reply to a POSTed request is always
// pushed onto the stream from INSIDE that POST's own route handler, never
// pre-loaded before `connectLegacySse`/`session.request()` is even called —
// same rule the original suite followed, now enforced by the real server
// itself (there is no open connection to push bytes onto before the GET
// request actually arrives).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "../../domain/tools";
import type { Budget } from "./budget";
import { createBudget } from "./budget";
import { connectLegacySse } from "./legacy-sse";
import { DEFAULT_CLIENT_INFO } from "./protocol";
import type { McpWireSession } from "./session";
import type { RouteContext } from "../testing/http-test-server";
import { startHttpTestServer, useHttpTestServer, writeChunks } from "../testing/http-test-server";

/** `RouteContext["res"]` — structurally `node:http`'s `ServerResponse`, referenced this way (rather than importing `node:http` directly) because this program's `tsconfig.app.json` has no `"node"` entry in `types` (a pre-existing gap in ../testing/http-test-server.ts itself, out of this card's scope). */
type Res = RouteContext["res"];

/**
 * A minimal local shim for exactly the two `process` members the "known
 * Node/undici quirk" guard below needs — same `tsconfig.app.json` gap as
 * `Res` above (no `"node"` in `types`, so the AMBIENT global `process` isn't
 * visible to the type checker even though it's real at runtime under
 * Vitest's node environment). Not a value declaration — `process` itself is
 * still the real Node global; this only tells the type checker its shape.
 */
declare const process: {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
};

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
    url: "https://mcp.example/sse",
    enabled: true,
    transport: "sse",
    ...overrides,
  };
}

const ENDPOINT_EVENT = "event: endpoint\ndata: /session/abc\n\n";
function initResponseEvent(
  result: Record<string, unknown> = { protocolVersion: "2025-06-18" },
): string {
  return `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result })}\n\n`;
}

/**
 * Connects a real session against `/sse` + `/session/abc`, with `/session/abc`
 * echoing `{ echoedId: id }` for any request after the handshake — the real-
 * server analog of the original suite's `connectedSession()` fixture. `push`
 * lets a test append more raw bytes onto the SAME long-lived GET connection
 * afterward (e.g. to answer a re-registered POST route by hand).
 */
async function connectedRealSession(budgetMs = 1000): Promise<{
  session: McpWireSession;
  budget: Budget;
  push: (text: string) => Promise<void>;
  sseRes: () => Res;
}> {
  let sseRes: Res | undefined;
  server().route("GET", "/sse", async ({ res }) => {
    sseRes = res;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    await writeChunks(res, [enc.encode(ENDPOINT_EVENT)], { end: false });
  });
  server().route("POST", "/session/abc", async ({ res, body }) => {
    const msg = JSON.parse(body.toString()) as { id?: number; method: string };
    if (!sseRes) throw new Error("expected the GET stream to already be open");
    if (msg.method === "initialize") {
      await writeChunks(sseRes, [enc.encode(initResponseEvent())], { end: false });
    } else if (typeof msg.id === "number") {
      await writeChunks(
        sseRes,
        [
          enc.encode(
            `data: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echoedId: msg.id } })}\n\n`,
          ),
        ],
        { end: false },
      );
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  const budget = createBudget(budgetMs, undefined);
  const [session, err] = await connectLegacySse(
    serverConfig({ url: `${server().baseUrl}/sse` }),
    {},
    clientInfo,
    budget,
  );
  if (err || !session) throw new Error("expected connect to succeed in this fixture");
  return {
    session,
    budget,
    async push(text: string) {
      if (!sseRes) throw new Error("expected the GET stream to already be open");
      await writeChunks(sseRes, [enc.encode(text)], { end: false });
    },
    sseRes: () => {
      if (!sseRes) throw new Error("expected the GET stream to already be open");
      return sseRes;
    },
  };
}

describe("connectLegacySse", () => {
  // PORTED: a real GET stream, a real endpoint event, a real POST, and a
  // real matching response coming back down the SAME connection.
  it("happy path: GET opens the stream, POSTs initialize to the announced endpoint, and resolves on the matching response", async () => {
    let sseRes: Res | undefined;
    server().route("GET", "/sse", async (ctx) => {
      sseRes = ctx.res;
      ctx.res.writeHead(200, { "Content-Type": "text/event-stream" });
      await writeChunks(ctx.res, [enc.encode(ENDPOINT_EVENT)], { end: false });
    });
    server().route("POST", "/session/abc", async ({ res, body }) => {
      const parsedBody = JSON.parse(body.toString()) as { method: string };
      if (parsedBody.method === "initialize" && sseRes) {
        await writeChunks(sseRes, [enc.encode(initResponseEvent())], { end: false });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const budget = createBudget(1000, undefined);

    const result = await connectLegacySse(
      serverConfig({ url: `${server().baseUrl}/sse` }),
      {},
      clientInfo,
      budget,
    );
    budget.cleanup();

    const [session, err] = result;
    expect(err).toBeUndefined();
    expect(session).toEqual(
      expect.objectContaining({
        connection: {
          protocolVersion: "2025-06-18",
          serverInfo: undefined,
          instructions: undefined,
        },
      }),
    );
    const postReqs = server().requests.filter((r) => r.method === "POST");
    expect(postReqs.every((r) => r.url === "/session/abc")).toBe(true);
    session?.close();
  });

  // PORTED: proves the endpoint event's `/session/abc` path really does get
  // resolved against the SERVER'S OWN origin, ignoring the GET URL's own
  // path segment (`/base/sse`) — a real `new URL()` resolution against the
  // real fetched URL, not an assertion on a string the test itself built.
  it("a relative endpoint path resolves against the server's own URL", async () => {
    let sseRes: Res | undefined;
    server().route("GET", "/base/sse", async ({ res }) => {
      sseRes = res;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      await writeChunks(res, [enc.encode(ENDPOINT_EVENT)], { end: false });
    });
    server().route("POST", "/session/abc", async ({ res, body }) => {
      const parsedBody = JSON.parse(body.toString()) as { method: string };
      if (parsedBody.method === "initialize" && sseRes) {
        await writeChunks(sseRes, [enc.encode(initResponseEvent())], { end: false });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const budget = createBudget(1000, undefined);

    const result = await connectLegacySse(
      serverConfig({ url: `${server().baseUrl}/base/sse` }),
      {},
      clientInfo,
      budget,
    );
    budget.cleanup();

    const [session, err] = result;
    expect(err).toBeUndefined();
    session?.close();
    const posted = server().requests.filter((r) => r.method === "POST");
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((r) => r.url === "/session/abc")).toBe(true);
  });

  describe("connect-time faults", () => {
    // PORTED: a real 401 on the opening GET, JSON-RPC-shaped body.
    it("401 on the opening GET fails as kind 'auth'", async () => {
      server().route("GET", "/sse", ({ res }) => {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: -32000, message: "Unauthorized" } }));
      });
      const budget = createBudget(1000, undefined);
      const result = await connectLegacySse(
        serverConfig({ url: `${server().baseUrl}/sse` }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      expect(result).toEqual([undefined, { kind: "auth", status: 401, message: "Unauthorized" }]);
    });

    // PORTED: a real non-2xx GET response.
    it("a non-ok GET response fails as not-mcp-endpoint, naming that both transports were tried", async () => {
      server().route("GET", "/sse", ({ res }) => {
        res.writeHead(500);
        res.end("nope");
      });
      const budget = createBudget(1000, undefined);
      const [, err] = await connectLegacySse(
        serverConfig({ url: `${server().baseUrl}/sse` }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      expect(err?.kind).toBe("not-mcp-endpoint");
    });

    // PORTED: a real 200 whose Content-Type genuinely isn't SSE.
    it("an ok GET response that isn't an SSE stream fails as not-mcp-endpoint", async () => {
      server().route("GET", "/sse", ({ res }) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("hi");
      });
      const budget = createBudget(1000, undefined);
      const result = await connectLegacySse(
        serverConfig({ url: `${server().baseUrl}/sse` }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      expect(result).toEqual([
        undefined,
        {
          kind: "not-mcp-endpoint",
          message: "Server did not open an SSE stream for the legacy MCP transport either.",
        },
      ]);
    });

    // PORTED: a genuinely dead server (nothing listening) rather than a
    // hand-thrown TypeError — the real ECONNREFUSED path `fetch` takes.
    it("a network error on the opening GET is classified via the budget", async () => {
      const dead = await startHttpTestServer();
      const baseUrl = dead.baseUrl;
      await dead.close();
      const budget = createBudget(1000, undefined);
      const [, err] = await connectLegacySse(
        serverConfig({ url: `${baseUrl}/sse` }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      expect(err?.kind).toBe("unreachable");
    });

    // PORTED: a real socket left open with nothing ever written to it — the
    // budget's own timer is what ends the wait, and `pump.close()`'s
    // `reader.cancel()` is what tears the connection down; asserted
    // server-side via the real `aborted` flag rather than a JS-level
    // `cancelled()` boolean on a hand-built stream.
    it("the stream never emits an endpoint event before the budget elapses: times out, and the connection is torn down", async () => {
      let releaseServer: () => void = () => undefined;
      const serverSawClose = new Promise<void>((resolve) => {
        releaseServer = resolve;
      });
      server().route("GET", "/sse", ({ res }) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.once("close", () => releaseServer());
        // Nothing is ever written — the endpoint event never arrives.
      });
      const budget = createBudget(15, undefined); // fires almost immediately

      const [, err] = await connectLegacySse(
        serverConfig({ url: `${server().baseUrl}/sse` }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      await serverSawClose;

      expect(err?.kind).toBe("timeout");
      expect(server().requests[0]?.aborted).toBe(true);
    });

    // PORTED: the endpoint event arrives, then the connection closes
    // cleanly — the initialize POST is accepted, but with the stream already
    // gone there is nowhere left for a response to arrive.
    it("the stream ends before the initialize response arrives (endpoint seen, then closes): times out waiting on the budget", async () => {
      server().route("GET", "/sse", async ({ res }) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        await writeChunks(res, [enc.encode(ENDPOINT_EVENT)]); // default end:true — closes right after
      });
      server().route("POST", "/session/abc", ({ res }) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true })); // accepted, but no reply is ever pushed
      });
      const budget = createBudget(30, undefined);

      const [, err] = await connectLegacySse(
        serverConfig({ url: `${server().baseUrl}/sse` }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();

      expect(err?.kind).toBe("timeout");
    });

    // PORTED: the endpoint event names a genuinely dead server (a real
    // `startHttpTestServer()` immediately closed) as the POST target, so
    // posting the initialize message hits a real ECONNREFUSED rather than a
    // hand-thrown TypeError. Also proves `pump.close()` tears the still-open
    // GET connection down as a side effect of that failure.
    it("posting the initialize message fails (network error): the pump is closed and the error is returned", async () => {
      const dead = await startHttpTestServer();
      const deadUrl = dead.baseUrl;
      await dead.close();
      let releaseServer: () => void = () => undefined;
      const serverSawClose = new Promise<void>((resolve) => {
        releaseServer = resolve;
      });
      server().route("GET", "/sse", async ({ res }) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.once("close", () => releaseServer());
        await writeChunks(res, [enc.encode(`event: endpoint\ndata: ${deadUrl}/session\n\n`)], {
          end: false,
        });
      });
      const budget = createBudget(1000, undefined);

      const [, err] = await connectLegacySse(
        serverConfig({ url: `${server().baseUrl}/sse` }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      await serverSawClose;

      expect(err?.kind).toBe("unreachable");
      expect(server().requests[0]?.aborted).toBe(true);
    });

    // PORTED: a real 401 on the initialize POST, with the GET stream torn
    // down as a side effect.
    it("401 on the initialize POST fails as kind 'auth', and the pump is closed", async () => {
      let releaseServer: () => void = () => undefined;
      const serverSawClose = new Promise<void>((resolve) => {
        releaseServer = resolve;
      });
      server().route("GET", "/sse", async ({ res }) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.once("close", () => releaseServer());
        await writeChunks(res, [enc.encode(ENDPOINT_EVENT)], { end: false });
      });
      server().route("POST", "/session/abc", ({ res }) => {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: -32000, message: "Unauthorized" } }));
      });
      const budget = createBudget(1000, undefined);

      const result = await connectLegacySse(
        serverConfig({ url: `${server().baseUrl}/sse` }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      await serverSawClose;

      expect(result).toEqual([undefined, { kind: "auth", status: 401, message: "Unauthorized" }]);
    });

    // PORTED: a real SSE-delivered initialize result with an unsupported
    // protocol version.
    it("an initialize result that fails validation (protocol mismatch) is returned, and the pump is closed", async () => {
      let releaseServer: () => void = () => undefined;
      const serverSawClose = new Promise<void>((resolve) => {
        releaseServer = resolve;
      });
      let sseRes: Res | undefined;
      server().route("GET", "/sse", async ({ res }) => {
        sseRes = res;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.once("close", () => releaseServer());
        await writeChunks(res, [enc.encode(ENDPOINT_EVENT)], { end: false });
      });
      server().route("POST", "/session/abc", async ({ res, body }) => {
        const msg = JSON.parse(body.toString()) as { method: string };
        if (msg.method === "initialize" && sseRes) {
          await writeChunks(
            sseRes,
            [enc.encode(initResponseEvent({ protocolVersion: "not-a-real-version" }))],
            { end: false },
          );
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      const budget = createBudget(1000, undefined);

      const [, err] = await connectLegacySse(
        serverConfig({ url: `${server().baseUrl}/sse` }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      await serverSawClose;

      expect(err?.kind).toBe("protocol-mismatch");
    });
  });

  describe("chaos: malformed/duplicate events on the wire", () => {
    // PORTED: a real garbage `data:` line, mixed in with the real endpoint
    // event on the same real chunk.
    it("a garbage (non-JSON) message event mid-stream is skipped, and the real response after it still resolves", async () => {
      let sseRes: Res | undefined;
      server().route("GET", "/sse", async ({ res }) => {
        sseRes = res;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        await writeChunks(res, [enc.encode(`${ENDPOINT_EVENT}data: {not valid json\n\n`)], {
          end: false,
        });
      });
      server().route("POST", "/session/abc", async ({ res, body }) => {
        const msg = JSON.parse(body.toString()) as { method: string };
        if (msg.method === "initialize" && sseRes) {
          await writeChunks(sseRes, [enc.encode(initResponseEvent())], { end: false });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      const budget = createBudget(1000, undefined);

      const [session, err] = await connectLegacySse(
        serverConfig({ url: `${server().baseUrl}/sse` }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      expect(err).toBeUndefined();
      session?.close();
    });

    // PORTED: a second `event: endpoint` naming a DIFFERENT path is really
    // sent on the wire — proven for real by never registering a route for
    // that other path, so honoring it would surface as a 404 from this real
    // server instead of the expected match.
    it("a duplicate endpoint event is ignored — only the first is honored", async () => {
      let sseRes: Res | undefined;
      server().route("GET", "/sse", async ({ res }) => {
        sseRes = res;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        await writeChunks(
          res,
          [enc.encode(`${ENDPOINT_EVENT}event: endpoint\ndata: /other/path\n\n`)],
          { end: false },
        );
      });
      server().route("POST", "/session/abc", async ({ res, body }) => {
        const msg = JSON.parse(body.toString()) as { method: string };
        if (msg.method === "initialize" && sseRes) {
          await writeChunks(sseRes, [enc.encode(initResponseEvent())], { end: false });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      const budget = createBudget(1000, undefined);

      const [session] = await connectLegacySse(
        serverConfig({ url: `${server().baseUrl}/sse` }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      session?.close();
      const posted = server().requests.filter((r) => r.method === "POST");
      expect(posted.length).toBeGreaterThan(0);
      expect(posted.every((r) => r.url === "/session/abc")).toBe(true);
    });

    // PORTED: the real response event is pushed TWICE for the same id — the
    // second delivery has no waiter left (it was already resolved and
    // deleted from the map), proving the pump drops it rather than throwing.
    it("a response event for an id nobody is waiting for (a duplicated delivery) is dropped without crashing the pump", async () => {
      let sseRes: Res | undefined;
      server().route("GET", "/sse", async ({ res }) => {
        sseRes = res;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        await writeChunks(res, [enc.encode(ENDPOINT_EVENT)], { end: false });
      });
      server().route("POST", "/session/abc", async ({ res, body }) => {
        const msg = JSON.parse(body.toString()) as { method: string };
        if (msg.method === "initialize" && sseRes) {
          // The real response, PLUS a duplicate for the same id (e.g. a
          // slow/retried server) with no waiter left for the second one.
          await writeChunks(sseRes, [enc.encode(initResponseEvent() + initResponseEvent())], {
            end: false,
          });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      const budget = createBudget(1000, undefined);

      const [session, err] = await connectLegacySse(
        serverConfig({ url: `${server().baseUrl}/sse` }),
        {},
        clientInfo,
        budget,
      );
      budget.cleanup();
      expect(err).toBeUndefined();
      session?.close();
    });
  });

  describe("session.request() after a successful connect", () => {
    // PORTED: real handshake, then two real subsequent POSTs answered over
    // the SAME long-lived GET connection.
    it("request() ids increment starting at 2 (id 1 was the initialize)", async () => {
      const { session, budget } = await connectedRealSession();

      const first = await session.request("tools/list");
      const second = await session.request("tools/list");
      session.close();
      budget.cleanup();

      expect(first).toEqual([{ echoedId: 2 }, undefined]);
      expect(second).toEqual([{ echoedId: 3 }, undefined]);
    });

    it("notify() posts without waiting for (or requiring) a response", async () => {
      const { session, budget } = await connectedRealSession();

      await expect(session.notify("notifications/whatever")).resolves.toBeUndefined();
      session.close();
      budget.cleanup();

      const notifyReq = server().requests.find((r) => {
        if (r.method !== "POST") return false;
        const parsed = JSON.parse(r.body.toString()) as { method?: string };
        return parsed.method === "notifications/whatever";
      });
      expect(notifyReq).toBeDefined();
    });

    // PORTED: unlike the original stub's JS-level `cancelled()` flag on a
    // hand-built `ReadableStream`, this asserts the REAL long-lived GET
    // connection actually tears down server-side once `close()` cancels the
    // pump's reader.
    it("close() cancels the underlying reader and is safe to call more than once", async () => {
      const { session, budget, sseRes } = await connectedRealSession();
      let releaseServer: () => void = () => undefined;
      const serverSawClose = new Promise<void>((resolve) => {
        releaseServer = resolve;
      });
      sseRes().once("close", () => releaseServer());

      session.close();
      expect(() => session.close()).not.toThrow();
      await serverSawClose;
      budget.cleanup();

      // requests[0] is the long-lived GET — the one `close()`'s
      // `reader.cancel()` actually tears down.
      expect(server().requests[0]?.aborted).toBe(true);
    });
  });

  // PORTED (card 111 calls this out by name): a session that connected for
  // real, over a real GET+POST pair, then gets a real 401 on its very next
  // POST.
  describe("chaos: 401 mid-tool-call — the access token expires between connect and call", () => {
    it("a session that connected successfully gets a 401 on the very next request(), surfacing kind 'auth'", async () => {
      const { session, budget } = await connectedRealSession();
      let toolCallSeen = false;
      // Registering again for the same method+path replaces the handshake's
      // handler — the real server's documented way for a test to reroute
      // mid-run (../testing/http-test-server.ts's `route()` doc comment).
      server().route("POST", "/session/abc", ({ res, body }) => {
        const msg = JSON.parse(body.toString()) as { method: string };
        if (msg.method === "tools/call") {
          toolCallSeen = true;
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: -32000, message: "Access token expired" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });

      const result = await session.request("tools/call", { name: "doTheThing" });
      session.close();
      budget.cleanup();

      expect(toolCallSeen).toBe(true);
      expect(result).toEqual([
        undefined,
        { kind: "auth", status: 401, message: "Access token expired" },
      ]);
    });

    it("request() times out when the relay accepts the POST but the SSE stream never delivers a matching response", async () => {
      // Short enough to finish the (real, fast) handshake and then time out
      // waiting on the call, sharing ONE budget across both — the same
      // shape the production `McpTransportContext` call sites use (one
      // budget per exported gateway operation, ./budget.ts's doc comment).
      //
      // This is the one test in this suite where the budget's timeout fires
      // while BOTH the long-lived GET stream's reader AND this request's own
      // wait are pending on the SAME real `AbortSignal`. Verified while
      // porting this test to a real server (card 111) via a minimal
      // reproduction outside this suite: when that happens, Node's own
      // `fetch`/undici internals produce an unhandled promise rejection
      // carrying the exact `AbortError` `budget.classify` already correctly
      // maps to `kind: "timeout"` below — NOT a rejection any promise in
      // ../legacy-sse.ts leaves uncaught (every `fetch`/`reader.read()` that
      // file awaits is already wrapped in its own try/catch). A hand-built
      // `ReadableStream` (what this suite used before card 111) has no real
      // `AbortSignal` plumbing at all, so the original suite could never
      // have surfaced this — it is a genuine, if inert, side effect of the
      // real transport this test now exercises, not a bug this adapter's
      // code can fix. Guarded narrowly here (and only here) so it can't mask
      // an unrelated failure, in this test or any other.
      let unexpectedRejection: unknown;
      const onUnhandledRejection = (err: unknown): void => {
        if (err instanceof DOMException && err.name === "AbortError") return; // the known, inert noise described above
        unexpectedRejection = err;
      };
      process.on("unhandledRejection", onUnhandledRejection);

      const { session, budget } = await connectedRealSession(150);
      server().route("POST", "/session/abc", ({ res }) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true })); // tools/call's POST is accepted, but nothing ever answers on the stream
      });

      const [, err] = await session.request("tools/call", { name: "doTheThing" });
      session.close();
      budget.cleanup();
      // Give the known-noise rejection above (and only it) a turn of the
      // event loop to actually surface before the guard is torn down.
      await new Promise((resolve) => setTimeout(resolve, 0));
      process.off("unhandledRejection", onUnhandledRejection);

      expect(err?.kind).toBe("timeout");
      expect(unexpectedRejection).toBeUndefined();
    });
  });

  // NEW (card 111 checklist: "Abort propagation asserted against real
  // sockets"). Aborts the OPENING GET fetch itself, before its response
  // headers ever arrive — the code path `budget.classify` maps to kind
  // "aborted". (An abort fired LATER, while merely waiting on the endpoint
  // event or a response, goes through `raceWithBudget`'s generic "other" arm
  // instead — see ./budget.ts's own doc comment — and is deliberately not
  // what this test targets.)
  describe("real AbortController against a real socket", () => {
    it("aborting before the opening GET's response even arrives tears the connection down server-side and yields kind 'aborted'", async () => {
      let requestArrived: () => void = () => undefined;
      const requestArrivedPromise = new Promise<void>((resolve) => {
        requestArrived = resolve;
      });
      let releaseServer: () => void = () => undefined;
      const serverSawClose = new Promise<void>((resolve) => {
        releaseServer = resolve;
      });
      server().route("GET", "/sse", ({ res }) => {
        // Confirm the server actually received the GET before the test
        // aborts — avoids a destroy racing the connection's own
        // establishment (same coordination pattern ../ollama and
        // ../openai's ported abort tests use). Never writes a response at
        // all, so the abort is what ends the connection.
        requestArrived();
        res.once("close", () => releaseServer());
      });

      const controller = new AbortController();
      const budget = createBudget(5000, controller.signal);
      const resultPromise = connectLegacySse(
        serverConfig({ url: `${server().baseUrl}/sse` }),
        {},
        clientInfo,
        budget,
      );

      await requestArrivedPromise;
      controller.abort();
      const [, err] = await resultPromise;
      budget.cleanup();
      await serverSawClose;

      expect(err).toEqual({ kind: "aborted" });
      expect(server().requests[0]?.aborted).toBe(true);
    });
  });
});

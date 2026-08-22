// A tiny, typed, in-process HTTP server for adapter tests that want REAL
// transport behaviour instead of a stubbed `fetch` — card 111
// (boards/project-backlog/111-realistic-adapter-tests.md, decisions/30).
//
// ../testing/fetch-stub.ts's `stubFetchByUrl`/`stubFetchSequence` hand-build
// `Response` objects entirely inside the JS process: real, but nothing about
// them ever crossed a socket. That's the right tool for pure error-mapping
// and JSON-envelope tests (still used all over this folder, deliberately —
// see each suite's own "ported vs. kept" note), but it can't catch a bug in
// how chunk boundaries interact with a streaming parser, whether a header
// really arrives at all once `Headers` serializes it onto the wire, or
// whether an `AbortController` actually tears down the TCP connection rather
// than just resolving a promise early. This module listens on a REAL
// ephemeral `127.0.0.1` port via `node:http` and lets a test register route
// handlers that see the real `IncomingMessage`/`ServerResponse` node:http
// gives a server, so `fetch()` in the code under test is exercising the same
// stack it does in production (minus TLS).
//
// Deliberately alongside ./fetch-stub.ts rather than under one
// src/infra/<tech>/ folder, for the same reason that file gives: real HTTP
// behaviour is wanted by three unrelated adapter stacks (ollama, openai,
// mcp) and belongs to none of them. Only ever imported from `*.test.ts`
// files, which — like fetch-stub.ts — are excluded outright from
// `.dependency-cruiser.cjs`'s rules (see its own doc comment on
// `\.test\.ts$`), so nothing here is production code a real adapter could
// reach for.
//
// Runs under the Vitest "domain" project (vitest.config.ts), which is
// `environment: "node"` specifically so `node:http` is available —
// deliberately unavailable in the "component" (jsdom) project, which never
// needs this.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Request capture
// ---------------------------------------------------------------------------

/** One request the server received, captured in arrival order for assertions. */
export interface CapturedRequest {
  readonly method: string;
  /** Path + query string, e.g. `"/api/chat?x=1"` — exactly `req.url`. */
  readonly url: string;
  /** Node's own lowercased header map — real wire header names are case-insensitive (RFC 7230 §3.2), and `node:http` normalizes to lowercase on receipt, so this is the honest shape to assert against rather than pretending a canonical case survived the trip. */
  readonly headers: Readonly<IncomingMessage["headers"]>;
  readonly body: Buffer;
  /**
   * Set once the connection tore down before the response finished writing —
   * either the client aborted (an `AbortController` firing mid-stream) or a
   * handler called {@link destroySocket}. `false` for the whole lifetime of a
   * request that got a normal, complete response.
   */
  aborted: boolean;
}

/** What a registered route handler receives. */
export interface RouteContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  /** The full request body, already buffered — every route on this server is handled after the request stream ends, so no handler needs to read `req` itself. */
  readonly body: Buffer;
  /** The same object recorded into `HttpTestServer.requests` for this request — mutate-free; `aborted` updates live on it as the connection's fate becomes known. */
  readonly captured: CapturedRequest;
}

export type RouteHandler = (ctx: RouteContext) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface HttpTestServer {
  /** e.g. `"http://127.0.0.1:54321"` — no trailing slash. */
  readonly baseUrl: string;
  /** Every request received so far, oldest first. Same array reference for the server's whole lifetime — read it any time, no need to re-fetch. */
  readonly requests: CapturedRequest[];
  /**
   * Register the handler for one exact method+path (query string ignored for
   * matching, still present on `req.url`/`captured.url`). Registering again
   * for the same method+path replaces the previous handler — lets a test
   * reroute mid-run (e.g. a fallback attempt after the first probe) without a
   * second server.
   */
  route(method: string, path: string, handler: RouteHandler): void;
  /** Stop accepting new connections and force-close every open socket (so a test hung on a still-open stream from a previous case never blocks teardown). Safe to call more than once. */
  close(): Promise<void>;
}

/**
 * Start a fresh server on an ephemeral `127.0.0.1` port. Each call is fully
 * independent (its own port, its own route table) — safe to run many in
 * parallel across test files, which is how Vitest actually schedules them.
 * Prefer {@link useHttpTestServer} inside a `describe` block unless a test
 * genuinely needs more than one server or to control the server's lifetime
 * itself.
 */
export async function startHttpTestServer(): Promise<HttpTestServer> {
  const routes = new Map<string, RouteHandler>();
  const requests: CapturedRequest[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void handle(req, res, Buffer.concat(chunks));
    });
  });

  // Tracked independently of `requests` so `close()` can force-destroy a
  // connection a test deliberately left open (a long-lived legacy-SSE GET
  // stream, or one a chaos case never wrote a terminal event to).
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  async function handle(req: IncomingMessage, res: ServerResponse, body: Buffer): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    const url = req.url ?? "/";
    const path = url.split("?")[0] || "/";
    const captured: CapturedRequest = {
      method,
      url,
      headers: { ...req.headers },
      body,
      aborted: false,
    };
    requests.push(captured);

    // Node fires 'aborted' on the request when the client tears the
    // connection down before the server finished responding — the
    // server-side signal real abort propagation tests assert against.
    req.on("aborted", () => {
      captured.aborted = true;
    });
    res.on("close", () => {
      if (!res.writableEnded) captured.aborted = true;
    });

    const handler = routes.get(`${method} ${path}`);
    if (!handler) {
      // Fail loud rather than hang, mirroring fetch-stub.ts's
      // `stubFetchByUrl` fallback: a forgotten route is a test bug, not a
      // server one.
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end(`no route registered for ${method} ${path}`);
      return;
    }
    try {
      await handler({ req, res, body, captured });
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
      if (!res.writableEnded) {
        res.end(
          `route handler threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
      }
    }
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    requests,
    route(method, path, handler) {
      routes.set(`${method.toUpperCase()} ${path}`, handler);
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

/**
 * `beforeEach`/`afterEach`-wired accessor: call once at the top of a
 * `describe` block, then call the returned function inside each `it` to get
 * that test's fresh server. Ephemeral ports mean many suites can run this
 * concurrently without colliding, and `close()` always runs even when a test
 * throws (Vitest's own `afterEach` guarantee) — the "clean per-test teardown"
 * half of the card's brief, without every suite hand-rolling it.
 */
export function useHttpTestServer(): () => HttpTestServer {
  let current: HttpTestServer | undefined;
  beforeEach(async () => {
    current = await startHttpTestServer();
  });
  afterEach(async () => {
    await current?.close();
    current = undefined;
  });
  return () => {
    if (!current) {
      throw new Error(
        "useHttpTestServer(): no server for the current test — called outside an it()?",
      );
    }
    return current;
  };
}

// ---------------------------------------------------------------------------
// Streaming response helpers
// ---------------------------------------------------------------------------

/**
 * Write `chunks` to `res` one at a time as genuinely separate TCP writes
 * (never coalesced into one `res.end(allBytes)`), optionally pausing between
 * them. This is how a test puts a chunk boundary somewhere specific — mid
 * UTF-8 multibyte character, mid JSON-line, mid SSE event — and is the
 * realistic replacement for a hand-built `ReadableStream` that `enqueue()`s
 * pre-split `Uint8Array`s: those never left the JS heap, so they prove a
 * parser handles a SPLIT, not that it handles a real one. Ends the response
 * afterward unless `opts.end` is `false` (leave the connection open for a
 * legacy-SSE-style long-lived stream a later route pushes more onto).
 */
export async function writeChunks(
  res: ServerResponse,
  chunks: readonly (string | Uint8Array)[],
  opts?: { delayMs?: number; end?: boolean },
): Promise<void> {
  for (const chunk of chunks) {
    const backpressured = !res.write(chunk);
    if (backpressured) {
      await new Promise<void>((resolve) => res.once("drain", resolve));
    }
    if (opts?.delayMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, opts.delayMs));
    } else {
      // No delay requested: still yield to the event loop so consecutive
      // synchronous writes reach the client as distinct reads rather than
      // Node batching them into a single one ahead of the next `await`.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  if (opts?.end !== false) res.end();
}

/**
 * Tear the connection down immediately and mid-response — a real truncated
 * connection (crashed upstream, a proxy dropping the socket), not a clean
 * `res.end()`. Whatever was already `res.write()`-ed (via {@link writeChunks}
 * or directly) is exactly what the client's reader sees before its next read
 * rejects; nothing further is sent. `HttpTestServer.close()` also force-closes
 * any socket a test forgets to destroy itself, but a test asserting the
 * CLIENT's reaction to a mid-stream drop should call this directly rather
 * than rely on that fallback's timing.
 */
export function destroySocket(res: ServerResponse): void {
  res.destroy();
}

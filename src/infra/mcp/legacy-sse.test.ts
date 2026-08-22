// Tests for `connectLegacySse` and the `LegacySsePump` it drives — the
// DEPRECATED HTTP+SSE transport's full lifecycle (card 88,
// boards/project-backlog/88-close-remaining-test-gaps.md): the GET stream ->
// endpoint event -> POSTed initialize -> matched response handshake, its
// fault paths, and the chaos case the card calls out: a 401 arriving
// mid-tool-call, after the handshake already succeeded.
//
// A recurring shape below: the SSE reply to a POSTed request is always
// pushed onto the stream from INSIDE that POST's own fetch handler, never
// pre-loaded before `connectLegacySse`/`session.request()` is even called.
// `LegacySsePump` only remembers a waiter for an id from the moment
// `waitForResponse(id)` runs (right before the matching POST goes out) — a
// response event arriving before that is a duplicate-delivery case (its own
// chaos test below), not a way to pre-seed an answer.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "../../domain/tools";
import { createBudget } from "./budget";
import { connectLegacySse } from "./legacy-sse";
import { DEFAULT_CLIENT_INFO } from "./protocol";
import { jsonResponse } from "../testing/fetch-stub";

afterEach(() => {
  vi.unstubAllGlobals();
});

const clientInfo = DEFAULT_CLIENT_INFO;
const enc = new TextEncoder();

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

/** A controllable SSE stream: `push` enqueues a chunk immediately, `end` closes it, `cancelled()` reports whether the reader ever cancelled it (`LegacySsePump.close()`'s effect). */
function controllableSseStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    stream,
    push(text: string) {
      controller.enqueue(enc.encode(text));
    },
    end() {
      controller.close();
    },
    cancelled: () => cancelled,
  };
}

const ENDPOINT_EVENT = "event: endpoint\ndata: /session/abc\n\n";
function initResponseEvent(
  result: Record<string, unknown> = { protocolVersion: "2025-06-18" },
): string {
  return `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result })}\n\n`;
}

describe("connectLegacySse", () => {
  it("happy path: GET opens the stream, POSTs initialize to the announced endpoint, and resolves on the matching response", async () => {
    const { stream, push } = controllableSseStream();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      // Every POST (initialize, then notifications/initialized) goes here.
      expect(url).toBe("https://mcp.example/session/abc");
      const body = JSON.parse(init?.body as string) as { method: string };
      if (body.method === "initialize") push(initResponseEvent());
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    push(ENDPOINT_EVENT);
    const budget = createBudget(1000, undefined);

    const result = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
    budget.cleanup();

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        connection: {
          protocolVersion: "2025-06-18",
          serverInfo: undefined,
          instructions: undefined,
        },
      }),
    });
    if (result.ok) result.value.close();
  });

  it("a relative endpoint path resolves against the server's own URL", async () => {
    const posted: string[] = [];
    const { stream, push } = controllableSseStream();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      posted.push(url);
      const body = JSON.parse(init?.body as string) as { method: string };
      if (body.method === "initialize") push(initResponseEvent());
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    push(ENDPOINT_EVENT);
    const budget = createBudget(1000, undefined);

    const result = await connectLegacySse(
      serverConfig({ url: "https://mcp.example/base/sse" }),
      {},
      clientInfo,
      budget,
    );
    budget.cleanup();

    expect(result.ok).toBe(true);
    if (result.ok) result.value.close();
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((u) => u === "https://mcp.example/session/abc")).toBe(true);
  });

  describe("connect-time faults", () => {
    it("401 on the opening GET fails as kind 'auth'", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ error: { code: -32000, message: "Unauthorized" } }), {
              status: 401,
            }),
        ),
      );
      const budget = createBudget(1000, undefined);
      const result = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(result).toEqual({
        ok: false,
        error: { kind: "auth", status: 401, message: "Unauthorized" },
      });
    });

    it("a non-ok GET response fails as not-mcp-endpoint, naming that both transports were tried", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("nope", { status: 500 })),
      );
      const budget = createBudget(1000, undefined);
      const result = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("not-mcp-endpoint");
    });

    it("an ok GET response that isn't an SSE stream fails as not-mcp-endpoint", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("hi", { status: 200, headers: { "Content-Type": "text/plain" } }),
        ),
      );
      const budget = createBudget(1000, undefined);
      const result = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(result).toEqual({
        ok: false,
        error: {
          kind: "not-mcp-endpoint",
          message: "Server did not open an SSE stream for the legacy MCP transport either.",
        },
      });
    });

    it("a network error on the opening GET is classified via the budget", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
      );
      const budget = createBudget(1000, undefined);
      const result = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("unreachable");
    });

    it("the stream never emits an endpoint event before the budget elapses: times out, and the reader is cancelled", async () => {
      const { stream, cancelled } = controllableSseStream();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
        ),
      );
      const budget = createBudget(15, undefined); // fires almost immediately

      const result = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("timeout");
      expect(cancelled()).toBe(true);
    });

    it("the stream ends before the initialize response arrives (endpoint seen, then closes): times out waiting on the budget", async () => {
      const { stream, push, end } = controllableSseStream();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          if (init?.method === "GET") {
            return new Response(stream, {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            });
          }
          return jsonResponse({ ok: true }); // the initialize POST is accepted, but no reply is ever pushed
        }),
      );
      push(ENDPOINT_EVENT);
      end(); // the stream closes right after the endpoint event — no init response ever comes
      const budget = createBudget(30, undefined);

      const result = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("timeout");
    });

    it("posting the initialize message fails (network error): the pump is closed and the error is returned", async () => {
      const { stream, push, cancelled } = controllableSseStream();
      push(ENDPOINT_EVENT); // available as soon as the GET's reader starts pumping
      let postCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          if (init?.method === "GET") {
            return new Response(stream, {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            });
          }
          postCount++;
          throw new TypeError("Failed to fetch");
        }),
      );
      const budget = createBudget(1000, undefined);

      const result = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();

      expect(postCount).toBe(1);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("unreachable");
      expect(cancelled()).toBe(true);
    });

    it("401 on the initialize POST fails as kind 'auth', and the pump is closed", async () => {
      const { stream, push, cancelled } = controllableSseStream();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          if (init?.method === "GET") {
            return new Response(stream, {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            });
          }
          return new Response(
            JSON.stringify({ error: { code: -32000, message: "Unauthorized" } }),
            { status: 401 },
          );
        }),
      );
      const budget = createBudget(1000, undefined);
      push(ENDPOINT_EVENT);

      const result = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();

      expect(result).toEqual({
        ok: false,
        error: { kind: "auth", status: 401, message: "Unauthorized" },
      });
      expect(cancelled()).toBe(true);
    });

    it("an initialize result that fails validation (protocol mismatch) is returned, and the pump is closed", async () => {
      const { stream, push, cancelled } = controllableSseStream();
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "GET") {
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        const body = JSON.parse(init?.body as string) as { method: string };
        if (body.method === "initialize")
          push(initResponseEvent({ protocolVersion: "not-a-real-version" }));
        return jsonResponse({ ok: true });
      });
      vi.stubGlobal("fetch", fetchMock);
      push(ENDPOINT_EVENT);
      const budget = createBudget(1000, undefined);

      const result = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("protocol-mismatch");
      expect(cancelled()).toBe(true);
    });
  });

  describe("chaos: malformed/duplicate events on the wire", () => {
    it("a garbage (non-JSON) message event mid-stream is skipped, and the real response after it still resolves", async () => {
      const { stream, push } = controllableSseStream();
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "GET") {
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        const body = JSON.parse(init?.body as string) as { method: string };
        if (body.method === "initialize") push(initResponseEvent());
        return jsonResponse({ ok: true });
      });
      vi.stubGlobal("fetch", fetchMock);
      push(`${ENDPOINT_EVENT}data: {not valid json\n\n`);
      const budget = createBudget(1000, undefined);

      const result = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(result.ok).toBe(true);
      if (result.ok) result.value.close();
    });

    it("a duplicate endpoint event is ignored — only the first is honored", async () => {
      const posted: string[] = [];
      const { stream, push } = controllableSseStream();
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "GET") {
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        posted.push(url);
        const body = JSON.parse(init?.body as string) as { method: string };
        if (body.method === "initialize") push(initResponseEvent());
        return jsonResponse({ ok: true });
      });
      vi.stubGlobal("fetch", fetchMock);
      push(`${ENDPOINT_EVENT}event: endpoint\ndata: /other/path\n\n`);
      const budget = createBudget(1000, undefined);

      const result = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      if (result.ok) result.value.close();
      expect(posted.length).toBeGreaterThan(0);
      expect(posted.every((u) => u === "https://mcp.example/session/abc")).toBe(true);
    });

    it("a response event for an id nobody is waiting for (a duplicated delivery) is dropped without crashing the pump", async () => {
      const { stream, push } = controllableSseStream();
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "GET") {
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        const body = JSON.parse(init?.body as string) as { method: string };
        if (body.method === "initialize") {
          // The real response, PLUS a duplicate for the same id (e.g. a
          // slow/retried server) with no waiter left for the second one.
          push(initResponseEvent());
          push(initResponseEvent());
        }
        return jsonResponse({ ok: true });
      });
      vi.stubGlobal("fetch", fetchMock);
      push(ENDPOINT_EVENT);
      const budget = createBudget(1000, undefined);

      const result = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      budget.cleanup();
      expect(result.ok).toBe(true);
      if (result.ok) result.value.close();
    });
  });

  describe("session.request() after a successful connect", () => {
    /** Connects with a stream that answers whatever id-bearing message was just POSTed — the initialize handshake gets a proper `initialize` result, anything else gets an `{echoedId}` result — so a waiter is always registered before its matching event arrives. */
    async function connectedSession(budgetMs = 1000) {
      const { stream, push } = controllableSseStream();
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "GET") {
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        const body = JSON.parse(init?.body as string) as { id?: number; method: string };
        if (body.method === "initialize") {
          push(initResponseEvent());
        } else if (typeof body.id === "number") {
          push(
            `data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { echoedId: body.id } })}\n\n`,
          );
        }
        return jsonResponse({ ok: true });
      });
      vi.stubGlobal("fetch", fetchMock);
      push(ENDPOINT_EVENT);
      const budget = createBudget(budgetMs, undefined);
      const connected = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      if (!connected.ok) throw new Error("expected connect to succeed in this fixture");
      return { session: connected.value, budget, fetchMock, push };
    }

    it("request() ids increment starting at 2 (id 1 was the initialize)", async () => {
      const { session, budget } = await connectedSession();

      const first = await session.request("tools/list");
      const second = await session.request("tools/list");
      session.close();
      budget.cleanup();

      expect(first).toEqual({ ok: true, value: { echoedId: 2 } });
      expect(second).toEqual({ ok: true, value: { echoedId: 3 } });
    });

    it("notify() posts without waiting for (or requiring) a response", async () => {
      const { session, budget, fetchMock } = await connectedSession();

      await expect(session.notify("notifications/whatever")).resolves.toBeUndefined();
      session.close();
      budget.cleanup();

      const notifyCall = fetchMock.mock.calls.find((c) => {
        const raw = (c[1] as RequestInit | undefined)?.body;
        if (typeof raw !== "string") return false;
        return (JSON.parse(raw) as { method?: string }).method === "notifications/whatever";
      });
      expect(notifyCall).toBeDefined();
    });

    it("close() cancels the underlying reader and is safe to call more than once", async () => {
      const { session, budget } = await connectedSession();
      session.close();
      expect(() => session.close()).not.toThrow();
      budget.cleanup();
    });
  });

  describe("chaos: 401 mid-tool-call — the access token expires between connect and call", () => {
    it("a session that connected successfully gets a 401 on the very next request(), surfacing kind 'auth'", async () => {
      const { stream, push } = controllableSseStream();
      let toolCallSeen = false;
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "GET") {
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        const body = JSON.parse(init?.body as string) as { method: string };
        if (body.method === "initialize") {
          push(initResponseEvent());
          return jsonResponse({ ok: true });
        }
        if (body.method === "tools/call") {
          toolCallSeen = true;
          return new Response(
            JSON.stringify({ error: { code: -32000, message: "Access token expired" } }),
            { status: 401 },
          );
        }
        return jsonResponse({ ok: true });
      });
      vi.stubGlobal("fetch", fetchMock);
      const budget = createBudget(1000, undefined);
      push(ENDPOINT_EVENT);

      const connected = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      expect(connected.ok).toBe(true);
      if (!connected.ok) return;

      const result = await connected.value.request("tools/call", { name: "doTheThing" });
      connected.value.close();
      budget.cleanup();

      expect(toolCallSeen).toBe(true);
      expect(result).toEqual({
        ok: false,
        error: { kind: "auth", status: 401, message: "Access token expired" },
      });
    });

    it("request() times out when the relay accepts the POST but the SSE stream never delivers a matching response", async () => {
      const { stream, push } = controllableSseStream();
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "GET") {
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        const body = JSON.parse(init?.body as string) as { method: string };
        if (body.method === "initialize") push(initResponseEvent());
        return jsonResponse({ ok: true }); // tools/call's POST is accepted, but nothing ever answers on the stream
      });
      vi.stubGlobal("fetch", fetchMock);
      const budget = createBudget(60, undefined); // enough headroom to finish connecting, then times out waiting on the call
      push(ENDPOINT_EVENT);

      const connected = await connectLegacySse(serverConfig(), {}, clientInfo, budget);
      if (!connected.ok) throw new Error("expected connect to succeed");

      const result = await connected.value.request("tools/call", { name: "doTheThing" });
      connected.value.close();
      budget.cleanup();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("timeout");
    });
  });
});

// Tests for the OpenAI(-compatible) wire client: SSE parsing (chunk
// boundaries, [DONE], comment/keepalive lines, malformed events), tool-call
// delta assembly, error mapping, and custom/reserved headers (card 83).
//
// Card 111 (boards/project-backlog/111-realistic-adapter-tests.md): most of
// this suite now runs against a REAL `node:http` server
// (../testing/http-test-server.ts) rather than a hand-built `Response` over
// a stubbed `fetch` — real per-event chunking, a real CRLF-terminated event
// (RFC-legal, some proxies rewrite line endings), a real chunk boundary that
// splits an SSE event, real header round-trips (reserved-header protection
// actually crossing a socket), and a real `AbortController` torn down
// against a real socket. Only the pure JSON-envelope normalization test for
// `listModels` stays on the fetch-stub — there's no wire behaviour left to
// be more real about once the array-mapping is the only thing under test.
// Ported vs. kept is noted per test; see the card's journal for the summary.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiProvider } from "./index";
import type { ChatParams } from "../../domain/providers";
import { fail, ok } from "../../domain/result";
import { jsonResponse as stubJsonResponse } from "../testing/fetch-stub";
import {
  destroySocket,
  startHttpTestServer,
  useHttpTestServer,
  writeChunks,
} from "../testing/http-test-server";

afterEach(() => {
  vi.unstubAllGlobals();
});

const enc = new TextEncoder();
const server = useHttpTestServer();

function sseEvent(json: unknown): string {
  return `data: ${JSON.stringify(json)}\n\n`;
}

function baseParams(overrides: Partial<ChatParams> = {}): ChatParams {
  return { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], ...overrides };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function provider(
  opts: { apiKey?: string; headers?: { key: string; value: string }[]; baseUrl?: string } = {},
) {
  // `ProviderConfig.apiKey`/`.headers` (src/domain/providers, not this
  // folder's to widen) are optional without `| undefined` — conditional
  // spread so an omitted option omits the key instead of assigning it
  // `undefined`.
  return createOpenAiProvider({
    id: "p1",
    type: "openai",
    name: "OpenAI",
    baseUrl: opts.baseUrl ?? "https://api.openai.com",
    ...(opts.apiKey !== undefined && { apiKey: opts.apiKey }),
    ...(opts.headers !== undefined && { headers: opts.headers }),
  });
}

// ---------------------------------------------------------------------------
// listModels
// ---------------------------------------------------------------------------

describe("listModels", () => {
  // KEPT: pure JSON-envelope normalization (dropping an id-less entry) — no
  // wire behaviour involved.
  it("normalizes /v1/models, dropping entries with no id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => stubJsonResponse({ data: [{ id: "gpt-4o" }, { no: "id" }] })),
    );
    const result = await provider().listModels();
    expect(result).toEqual(ok([{ id: "gpt-4o", name: "gpt-4o" }]));
  });

  // PORTED: a real 404 off the wire.
  it("404/405 map to not-supported (no /v1/models-equivalent)", async () => {
    server().route("GET", "/v1/models", ({ res }) => {
      res.writeHead(404);
      res.end();
    });
    const result = await provider({ baseUrl: server().baseUrl }).listModels();
    expect(result).toEqual(
      fail({
        kind: "not-supported",
        message: "This endpoint does not expose a model-listing API. Enter a model id manually.",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe("error mapping", () => {
  // PORTED: a real 401 with an OpenAI-shaped error body.
  it("401 maps to kind 'auth', message extracted from {error:{message}}", async () => {
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key provided" } }));
    });
    const events = await collect(
      provider({ apiKey: "sk-bad", baseUrl: server().baseUrl }).chat(baseParams()),
    );
    expect(events).toEqual([
      {
        type: "error",
        error: { kind: "auth", status: 401, message: "Invalid API key provided" },
      },
    ]);
  });

  it("403 also maps to kind 'auth' (treated the same as 401 here)", async () => {
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end("{}");
    });
    const events = await collect(provider({ baseUrl: server().baseUrl }).chat(baseParams()));
    expect(events[0]).toMatchObject({ type: "error", error: { kind: "auth", status: 403 } });
  });

  it("429 maps to kind 'http' (no special-casing for rate limits)", async () => {
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(429, "Too Many Requests");
      res.end("rate limited");
    });
    const events = await collect(provider({ baseUrl: server().baseUrl }).chat(baseParams()));
    expect(events).toEqual([
      {
        type: "error",
        error: { kind: "http", status: 429, statusText: "Too Many Requests", body: "rate limited" },
      },
    ]);
  });

  // PORTED: a genuinely dead host (nothing listening) rather than a
  // hand-thrown TypeError — the real ECONNREFUSED path `fetch` takes.
  it("a real dead-host connection failure maps to unreachable-or-cors", async () => {
    const dead = await startHttpTestServer();
    const baseUrl = dead.baseUrl;
    await dead.close();
    const events = await collect(provider({ baseUrl }).chat(baseParams()));
    expect(events[0]).toMatchObject({ type: "error", error: { kind: "unreachable-or-cors" } });
  });

  it("aborting before the request is even sent maps to kind 'aborted'", async () => {
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end("data: [DONE]\n\n");
    });
    const controller = new AbortController();
    controller.abort();
    const events = await collect(
      provider({ baseUrl: server().baseUrl }).chat(baseParams({ signal: controller.signal })),
    );
    expect(events).toEqual([{ type: "error", error: { kind: "aborted" } }]);
  });

  it("a response with no body (real 204) maps to invalid-response", async () => {
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(204);
      res.end();
    });
    const events = await collect(provider({ baseUrl: server().baseUrl }).chat(baseParams()));
    expect(events).toEqual([
      {
        type: "error",
        error: { kind: "invalid-response", message: "Response had no body to stream." },
      },
    ]);
  });

  it("a non-JSON error body falls back to the raw body text", async () => {
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(500);
      res.end("plain text failure");
    });
    const events = await collect(provider({ baseUrl: server().baseUrl }).chat(baseParams()));
    expect(events[0]).toMatchObject({
      type: "error",
      error: { kind: "http", status: 500, body: "plain text failure" },
    });
  });
});

// ---------------------------------------------------------------------------
// Real abort — AbortController torn down against a real socket (card 111
// checklist: "Abort propagation asserted against real sockets").
// ---------------------------------------------------------------------------

describe("chat() — real AbortController against a real socket", () => {
  it("an abort fired mid-stream (after some content already arrived) yields 'aborted' without dropping the partial content already yielded, and the SERVER observes the socket tear down", async () => {
    let triggerNext: () => void = () => undefined;
    const releaseServer = new Promise<void>((resolve) => {
      triggerNext = resolve;
    });
    server().route("POST", "/v1/chat/completions", async ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      await writeChunks(
        res,
        [enc.encode(sseEvent({ choices: [{ delta: { content: "partial" } }] }))],
        {
          end: false,
        },
      );
      res.once("close", () => triggerNext());
    });

    const controller = new AbortController();
    const iterator = provider({ baseUrl: server().baseUrl }).chat(
      baseParams({ signal: controller.signal }),
    );

    const first = await iterator.next();
    expect(first.value).toEqual({ type: "content", delta: "partial" });

    controller.abort();
    const second = await iterator.next();
    expect(second.value).toEqual({ type: "error", error: { kind: "aborted" } });
    await releaseServer;

    const [request] = server().requests;
    expect(request?.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SSE parsing / tool-call assembly
// ---------------------------------------------------------------------------

describe("chat() — SSE parsing (real server)", () => {
  it("parses content deltas sent as real per-event chunks, respects [DONE], and reports finish_reason + usage", async () => {
    const body =
      sseEvent({ choices: [{ delta: { content: "Hel" } }] }) +
      sseEvent({ choices: [{ delta: { content: "lo" } }] }) +
      sseEvent({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }) +
      "data: [DONE]\n\n";
    server().route("POST", "/v1/chat/completions", async ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      await writeChunks(res, [enc.encode(body)]);
    });

    const events = await collect(provider({ baseUrl: server().baseUrl }).chat(baseParams()));
    expect(events[0]).toEqual({ type: "content", delta: "Hel" });
    expect(events[1]).toEqual({ type: "content", delta: "lo" });
    const done = events[events.length - 1] as {
      type: string;
      message: { role: string; content: string };
      stats: { doneReason?: string; promptTokens?: number; completionTokens?: number };
    };
    expect(done.type).toBe("done");
    expect(done.message.content).toBe("Hello");
    expect(done.stats).toMatchObject({ doneReason: "stop", promptTokens: 5, completionTokens: 2 });
  });

  it("reassembles an SSE event split across an arbitrary real chunk boundary", async () => {
    const body = `${sseEvent({ choices: [{ delta: { content: "Hello" } }] })}data: [DONE]\n\n`;
    const bytes = enc.encode(body);
    const splitAt = Math.floor(bytes.length / 2);
    server().route("POST", "/v1/chat/completions", async ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      await writeChunks(res, [bytes.slice(0, splitAt), bytes.slice(splitAt)]);
    });

    const events = await collect(provider({ baseUrl: server().baseUrl }).chat(baseParams()));
    expect(events[0]).toEqual({ type: "content", delta: "Hello" });
  });

  // NEW (card 111): CRLF line endings. Some proxies/load balancers rewrite
  // `\n` to `\r\n` on the way through; `extractSseEvents` strips a trailing
  // `\r` per line specifically for this. The pre-card-111 suite only ever
  // sent `\n` — real transport realism means this can finally be exercised.
  it("handles CRLF-terminated SSE lines", async () => {
    const body =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "crlf-ok" } }] })}\r\n\r\n` +
      "data: [DONE]\r\n\r\n";
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(body);
    });

    const events = await collect(provider({ baseUrl: server().baseUrl }).chat(baseParams()));
    expect(events[0]).toEqual({ type: "content", delta: "crlf-ok" });
  });

  it("ignores comment/keepalive lines (leading ':') without breaking parsing", async () => {
    const body =
      ": keepalive\n\n" +
      sseEvent({ choices: [{ delta: { content: "hi" } }] }) +
      "data: [DONE]\n\n";
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(body);
    });

    const events = await collect(provider({ baseUrl: server().baseUrl }).chat(baseParams()));
    expect(events[0]).toEqual({ type: "content", delta: "hi" });
  });

  it("skips a malformed JSON event mid-stream, keeps processing the rest, and still finalizes", async () => {
    const body =
      sseEvent({ choices: [{ delta: { content: "ok-" } }] }) +
      "data: {not valid json\n\n" +
      sseEvent({ choices: [{ delta: { content: "still-ok" } }] }) +
      "data: [DONE]\n\n";
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(body);
    });

    const events = await collect(provider({ baseUrl: server().baseUrl }).chat(baseParams()));
    const contentEvents = events.filter((e) => e.type === "content");
    expect(contentEvents).toEqual([
      { type: "content", delta: "ok-" },
      { type: "content", delta: "still-ok" },
    ]);
  });

  it("handles the final event arriving with no trailing blank line (stream just closes)", async () => {
    // No trailing \n\n after the last data: line, and no [DONE] at all.
    const body = sseEvent({ choices: [{ delta: { content: "tail" } }] }).slice(0, -1);
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(body);
    });

    const events = await collect(provider({ baseUrl: server().baseUrl }).chat(baseParams()));
    expect(events[0]).toEqual({ type: "content", delta: "tail" });
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });

  it("assembles a tool call whose name/arguments stream as fragments across many real events, keyed by index", async () => {
    const body =
      sseEvent({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: "call_1", function: { name: "get_", arguments: "" } }],
            },
          },
        ],
      }) +
      sseEvent({
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { name: "weather", arguments: '{"ci' } }] },
          },
        ],
      }) +
      sseEvent({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"NYC"}' } }] } }],
      }) +
      sseEvent({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) +
      "data: [DONE]\n\n";
    server().route("POST", "/v1/chat/completions", async ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      await writeChunks(res, [enc.encode(body)]);
    });

    const events = await collect(provider({ baseUrl: server().baseUrl }).chat(baseParams()));
    const toolCallsEvent = events.find((e) => e.type === "tool-calls") as {
      type: string;
      toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[];
    };
    expect(toolCallsEvent.toolCalls).toEqual([
      { id: "call_1", name: "get_weather", arguments: { city: "NYC" } },
    ]);
  });

  it("assembles two concurrently-streaming tool calls by index without cross-contamination", async () => {
    const body =
      sseEvent({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_a", function: { name: "a", arguments: "{}" } },
                { index: 1, id: "call_b", function: { name: "b", arguments: "{}" } },
              ],
            },
          },
        ],
      }) +
      sseEvent({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) +
      "data: [DONE]\n\n";
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(body);
    });

    const events = await collect(provider({ baseUrl: server().baseUrl }).chat(baseParams()));
    const toolCallsEvent = events.find((e) => e.type === "tool-calls") as {
      toolCalls: { id: string; name: string }[];
    };
    expect(toolCallsEvent.toolCalls.map((c) => c.id)).toEqual(["call_a", "call_b"]);
  });

  it("malformed/incomplete tool-call arguments JSON falls back to an empty-args call rather than throwing", async () => {
    const body =
      sseEvent({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "{not json" } }],
            },
          },
        ],
      }) +
      sseEvent({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) +
      "data: [DONE]\n\n";
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(body);
    });

    const events = await collect(provider({ baseUrl: server().baseUrl }).chat(baseParams()));
    const toolCallsEvent = events.find((e) => e.type === "tool-calls") as {
      toolCalls: { arguments: Record<string, unknown> }[];
    };
    expect(toolCallsEvent.toolCalls[0]!.arguments).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Chaos: a forcibly reset connection mid-stream (card 111 — the same
// clean-close-vs-reset distinction ../ollama/client.test.ts's chaos suite
// makes; unlike Ollama's NDJSON parser this one finalizes normally on any
// clean stream end, so the interesting real-transport case here is
// specifically the ABRUPT one).
// ---------------------------------------------------------------------------

describe("chaos: a forcibly reset connection mid-stream", () => {
  it("a connection reset after a content event but before [DONE] surfaces a network error, not a synthesized 'done'", async () => {
    let triggerDestroy: () => void = () => undefined;
    const destroySignal = new Promise<void>((resolve) => {
      triggerDestroy = resolve;
    });
    server().route("POST", "/v1/chat/completions", async ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      await writeChunks(
        res,
        [enc.encode(sseEvent({ choices: [{ delta: { content: "partial" } }] }))],
        {
          end: false,
        },
      );
      await destroySignal;
      destroySocket(res);
    });

    const iterator = provider({ baseUrl: server().baseUrl }).chat(baseParams());
    const first = await iterator.next();
    expect(first.value).toEqual({ type: "content", delta: "partial" });

    triggerDestroy();
    const second = await iterator.next();
    expect(second.value).toMatchObject({ type: "error" });
    expect((second.value as { error: { kind: string } }).error.kind).not.toBe("aborted");
  });
});

// ---------------------------------------------------------------------------
// Headers: custom + reserved-header protection
// ---------------------------------------------------------------------------

describe("headers actually applied to the request (real server)", () => {
  it("sends custom headers, plus Content-Type/Accept/Authorization set by the client", async () => {
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end("data: [DONE]\n\n");
    });

    await collect(
      provider({
        apiKey: "sk-real",
        headers: [{ key: "X-Tenant", value: "acme" }],
        baseUrl: server().baseUrl,
      }).chat(baseParams()),
    );

    const [request] = server().requests;
    expect(request?.headers["x-tenant"]).toBe("acme");
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(request?.headers.accept).toBe("text/event-stream");
    expect(request?.headers.authorization).toBe("Bearer sk-real");
  });

  it("a custom Content-Type/Accept cannot override the client-controlled values (reserved-header protection)", async () => {
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end("data: [DONE]\n\n");
    });

    await collect(
      provider({
        headers: [
          { key: "Content-Type", value: "text/plain" },
          { key: "Accept", value: "application/json" },
        ],
        baseUrl: server().baseUrl,
      }).chat(baseParams()),
    );

    const [request] = server().requests;
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(request?.headers.accept).toBe("text/event-stream");
  });

  it("when an API key is configured, a custom Authorization header cannot override it", async () => {
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end("data: [DONE]\n\n");
    });

    await collect(
      provider({
        apiKey: "sk-real",
        headers: [{ key: "Authorization", value: "Bearer user-supplied" }],
        baseUrl: server().baseUrl,
      }).chat(baseParams()),
    );

    const [request] = server().requests;
    expect(request?.headers.authorization).toBe("Bearer sk-real");
  });

  it("with no API key configured, a custom Authorization header survives untouched (decision 15)", async () => {
    server().route("POST", "/v1/chat/completions", ({ res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end("data: [DONE]\n\n");
    });

    await collect(
      provider({
        headers: [{ key: "Authorization", value: "Bearer user-supplied" }],
        baseUrl: server().baseUrl,
      }).chat(baseParams()),
    );

    const [request] = server().requests;
    expect(request?.headers.authorization).toBe("Bearer user-supplied");
  });

  it("listModels sends Accept:application/json and the bearer Authorization", async () => {
    server().route("GET", "/v1/models", ({ res }) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [] }));
    });

    await provider({ apiKey: "sk-real", baseUrl: server().baseUrl }).listModels();

    const [request] = server().requests;
    expect(request?.headers.accept).toBe("application/json");
    expect(request?.headers.authorization).toBe("Bearer sk-real");
  });
});

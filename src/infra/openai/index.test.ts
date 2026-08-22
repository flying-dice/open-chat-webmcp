// Tests for the OpenAI(-compatible) wire client: SSE parsing (chunk
// boundaries, [DONE], comment/keepalive lines, malformed events), tool-call
// delta assembly, error mapping, and custom/reserved headers (card 83).

import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiProvider } from "./index";
import type { ChatParams } from "../../domain/providers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function sseResponse(chunks: Uint8Array[], init?: ResponseInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

const enc = new TextEncoder();

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

function provider(opts: { apiKey?: string; headers?: { key: string; value: string }[] } = {}) {
  return createOpenAiProvider({
    id: "p1",
    type: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com",
    apiKey: opts.apiKey,
    headers: opts.headers,
  });
}

// ---------------------------------------------------------------------------
// listModels
// ---------------------------------------------------------------------------

describe("listModels", () => {
  it("normalizes /v1/models, dropping entries with no id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [{ id: "gpt-4o" }, { no: "id" }] })),
    );
    const result = await provider().listModels();
    expect(result).toEqual({ ok: true, value: [{ id: "gpt-4o", name: "gpt-4o" }] });
  });

  it("404/405 map to not-supported (no /v1/models-equivalent)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const result = await provider().listModels();
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "not-supported",
        message: "This endpoint does not expose a model-listing API. Enter a model id manually.",
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe("error mapping", () => {
  it("401 maps to kind 'auth', message extracted from {error:{message}}", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "Invalid API key provided" } }), {
            status: 401,
          }),
      ),
    );
    const events = await collect(provider({ apiKey: "sk-bad" }).chat(baseParams()));
    expect(events).toEqual([
      {
        type: "error",
        error: { kind: "auth", status: 401, message: "Invalid API key provided" },
      },
    ]);
  });

  it("403 also maps to kind 'auth' (treated the same as 401 here)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    const events = await collect(provider().chat(baseParams()));
    expect(events[0]).toMatchObject({ type: "error", error: { kind: "auth", status: 403 } });
  });

  it("429 maps to kind 'http' (no special-casing for rate limits)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429, statusText: "Too Many Requests" })),
    );
    const events = await collect(provider().chat(baseParams()));
    expect(events).toEqual([
      {
        type: "error",
        error: { kind: "http", status: 429, statusText: "Too Many Requests", body: "rate limited" },
      },
    ]);
  });

  it("a bare TypeError (unreachable / no host permission) maps to unreachable-or-cors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const events = await collect(provider().chat(baseParams()));
    expect(events[0]).toMatchObject({ type: "error", error: { kind: "unreachable-or-cors" } });
  });

  it("an AbortError maps to kind 'aborted'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    const events = await collect(provider().chat(baseParams()));
    expect(events).toEqual([{ type: "error", error: { kind: "aborted" } }]);
  });

  it("a response with no body maps to invalid-response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const events = await collect(provider().chat(baseParams()));
    expect(events).toEqual([
      { type: "error", error: { kind: "invalid-response", message: "Response had no body to stream." } },
    ]);
  });

  it("a non-JSON error body falls back to the raw body text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("plain text failure", { status: 500 })));
    const events = await collect(provider().chat(baseParams()));
    expect(events[0]).toMatchObject({
      type: "error",
      error: { kind: "http", status: 500, body: "plain text failure" },
    });
  });
});

// ---------------------------------------------------------------------------
// SSE parsing / tool-call assembly
// ---------------------------------------------------------------------------

describe("chat() — SSE parsing", () => {
  it("parses content deltas, respects [DONE], and reports finish_reason + usage", async () => {
    const body =
      sseEvent({ choices: [{ delta: { content: "Hel" } }] }) +
      sseEvent({ choices: [{ delta: { content: "lo" } }] }) +
      sseEvent({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }) +
      "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([enc.encode(body)])));

    const events = await collect(provider().chat(baseParams()));
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

  it("reassembles an SSE event split across an arbitrary chunk boundary", async () => {
    const body = sseEvent({ choices: [{ delta: { content: "Hello" } }] }) + "data: [DONE]\n\n";
    const bytes = enc.encode(body);
    const splitAt = Math.floor(bytes.length / 2);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([bytes.slice(0, splitAt), bytes.slice(splitAt)])),
    );

    const events = await collect(provider().chat(baseParams()));
    expect(events[0]).toEqual({ type: "content", delta: "Hello" });
  });

  it("ignores comment/keepalive lines (leading ':') without breaking parsing", async () => {
    const body = ": keepalive\n\n" + sseEvent({ choices: [{ delta: { content: "hi" } }] }) + "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([enc.encode(body)])));

    const events = await collect(provider().chat(baseParams()));
    expect(events[0]).toEqual({ type: "content", delta: "hi" });
  });

  it("skips a malformed JSON event mid-stream, keeps processing the rest, and still finalizes", async () => {
    const body =
      sseEvent({ choices: [{ delta: { content: "ok-" } }] }) +
      "data: {not valid json\n\n" +
      sseEvent({ choices: [{ delta: { content: "still-ok" } }] }) +
      "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([enc.encode(body)])));

    const events = await collect(provider().chat(baseParams()));
    const contentEvents = events.filter((e) => e.type === "content");
    expect(contentEvents).toEqual([
      { type: "content", delta: "ok-" },
      { type: "content", delta: "still-ok" },
    ]);
  });

  it("handles the final event arriving with no trailing blank line (stream just closes)", async () => {
    // No trailing \n\n after the last data: line, and no [DONE] at all.
    const body = sseEvent({ choices: [{ delta: { content: "tail" } }] }).slice(0, -1);
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([enc.encode(body)])));

    const events = await collect(provider().chat(baseParams()));
    expect(events[0]).toEqual({ type: "content", delta: "tail" });
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });

  it("assembles a tool call whose name/arguments stream as fragments across many events, keyed by index", async () => {
    const body =
      sseEvent({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_", arguments: "" } }] } }] }) +
      sseEvent({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "weather", arguments: '{"ci' } }] } }] }) +
      sseEvent({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"NYC"}' } }] } }] }) +
      sseEvent({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) +
      "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([enc.encode(body)])));

    const events = await collect(provider().chat(baseParams()));
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
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([enc.encode(body)])));

    const events = await collect(provider().chat(baseParams()));
    const toolCallsEvent = events.find((e) => e.type === "tool-calls") as {
      toolCalls: { id: string; name: string }[];
    };
    expect(toolCallsEvent.toolCalls.map((c) => c.id)).toEqual(["call_a", "call_b"]);
  });

  it("malformed/incomplete tool-call arguments JSON falls back to an empty-args call rather than throwing", async () => {
    const body =
      sseEvent({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "{not json" } }] } }] }) +
      sseEvent({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) +
      "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([enc.encode(body)])));

    const events = await collect(provider().chat(baseParams()));
    const toolCallsEvent = events.find((e) => e.type === "tool-calls") as {
      toolCalls: { arguments: Record<string, unknown> }[];
    };
    expect(toolCallsEvent.toolCalls[0].arguments).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Headers: custom + reserved-header protection
// ---------------------------------------------------------------------------

describe("headers actually applied to the request", () => {
  it("sends custom headers, plus Content-Type/Accept/Authorization set by the client", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      sseResponse([enc.encode("data: [DONE]\n\n")]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await collect(
      provider({ apiKey: "sk-real", headers: [{ key: "X-Tenant", value: "acme" }] }).chat(baseParams()),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("X-Tenant")).toBe("acme");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("text/event-stream");
    expect(headers.get("Authorization")).toBe("Bearer sk-real");
  });

  it("a custom Content-Type/Accept cannot override the client-controlled values (reserved-header protection)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      sseResponse([enc.encode("data: [DONE]\n\n")]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await collect(
      provider({
        headers: [
          { key: "Content-Type", value: "text/plain" },
          { key: "Accept", value: "application/json" },
        ],
      }).chat(baseParams()),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("text/event-stream");
  });

  it("when an API key is configured, a custom Authorization header cannot override it", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      sseResponse([enc.encode("data: [DONE]\n\n")]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await collect(
      provider({
        apiKey: "sk-real",
        headers: [{ key: "Authorization", value: "Bearer user-supplied" }],
      }).chat(baseParams()),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer sk-real");
  });

  it("with no API key configured, a custom Authorization header survives untouched (decision 15)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      sseResponse([enc.encode("data: [DONE]\n\n")]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await collect(
      provider({ headers: [{ key: "Authorization", value: "Bearer user-supplied" }] }).chat(baseParams()),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer user-supplied");
  });

  it("listModels sends Accept:application/json and the bearer Authorization", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await provider({ apiKey: "sk-real" }).listModels();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer sk-real");
  });
});

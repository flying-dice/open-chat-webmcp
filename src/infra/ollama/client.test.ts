// Tests for the raw Ollama wire client: NDJSON stream parsing (chunk
// boundaries, garbage lines, abort), capability probing over /api/show, and
// error mapping (including the 403 origin-rejection special case) (card 83).

import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeChromeStorage } from "../chrome-storage/testing/fake-chrome-storage";
import { chat, getCapabilities, listModels, type OllamaChatParams } from "./client";

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

function streamResponse(chunks: Uint8Array[], init?: ResponseInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// listModels
// ---------------------------------------------------------------------------

describe("listModels", () => {
  it("normalizes the /api/tags response, GET with no body", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({
        models: [
          {
            name: "llama3.1:8b",
            digest: "sha256:abc",
            size: 123,
            modified_at: "2024-01-01",
            details: { family: "llama", parameter_size: "8B", quantization_level: "Q4_0" },
          },
          { not: "a model" }, // dropped defensively
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listModels({ baseUrl: "http://localhost:11434" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        name: "llama3.1:8b",
        digest: "sha256:abc",
        size: 123,
        modifiedAt: "2024-01-01",
        family: "llama",
        parameterSize: "8B",
        quantizationLevel: "Q4_0",
      },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/tags");
    expect(init.method).toBe("GET");
  });

  it("applies custom headers (decisions/15) on top of no Content-Type for a GET", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ models: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listModels({
      baseUrl: "http://localhost:11434",
      headers: [{ key: "X-Gateway-Key", value: "secret" }],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("X-Gateway-Key")).toBe("secret");
    expect(headers.get("Content-Type")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe("error mapping", () => {
  it("maps a 403 to unreachable-or-cors with the origin-rejection message and a copyable fix (decisions/33)", async () => {
    const fake = createFakeChromeStorage();
    vi.stubGlobal("chrome", fake.chrome);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403, statusText: "Forbidden" })),
    );

    const result = await listModels({ baseUrl: "http://localhost:11434" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unreachable-or-cors");
    if (result.error.kind !== "unreachable-or-cors") return;
    expect(result.error.message).toContain("rejected this request because of its");
    expect(result.error.message).toContain("chrome-extension://fake-extension-id");
    expect(result.error.fix).toEqual({
      label: "Set OLLAMA_ORIGINS, then restart Ollama",
      command: 'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"',
    });
  });

  it("maps a non-403 HTTP error to kind 'http' with status/statusText/body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("server exploded", { status: 500, statusText: "Internal Error" }),
      ),
    );

    const result = await listModels({ baseUrl: "http://localhost:11434" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: "http",
      status: 500,
      statusText: "Internal Error",
      body: "server exploded",
    });
  });

  it("maps a bare TypeError (dead server or blocked CORS preflight) to unreachable-or-cors with the OLLAMA_ORIGINS fix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const result = await listModels({ baseUrl: "http://localhost:11434" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unreachable-or-cors");
    if (result.error.kind !== "unreachable-or-cors") return;
    expect(result.error.fix?.command).toBe("OLLAMA_ORIGINS=chrome-extension://*");
  });

  it("maps a malformed JSON body to invalid-response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );
    const result = await listModels({ baseUrl: "http://localhost:11434" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid-response");
  });
});

// ---------------------------------------------------------------------------
// getCapabilities — capability probing over /api/show, digest-cached
// ---------------------------------------------------------------------------

describe("getCapabilities", () => {
  function fakeCache() {
    const store = new Map<string, unknown>();
    return {
      get: vi.fn(async (type: string, fp: string) => store.get(`${type}:${fp}`)),
      set: vi.fn(async (type: string, fp: string, v: unknown) => {
        store.set(`${type}:${fp}`, v);
      }),
    };
  }

  it("a cache hit never calls fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const cache = fakeCache();
    await cache.set("ollama", "d1", { status: "tool-capable", detail: [] });

    const result = await getCapabilities(
      { name: "m", digest: "d1" },
      { baseUrl: "http://x", capabilityCache: cache as never },
    );
    expect(result).toEqual({ ok: true, value: { status: "tool-capable", detail: [] } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a cache miss POSTs /api/show, maps 'tools' capability to tool-capable, and files the answer", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ capabilities: ["completion", "tools"] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cache = fakeCache();

    const result = await getCapabilities(
      { name: "llama3.1:8b", digest: "d1" },
      { baseUrl: "http://localhost:11434", capabilityCache: cache as never },
    );

    expect(result).toEqual({
      ok: true,
      value: { status: "tool-capable", detail: ["completion", "tools"] },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/show");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ model: "llama3.1:8b" });
    expect(cache.set).toHaveBeenCalledWith("ollama", "d1", {
      status: "tool-capable",
      detail: ["completion", "tools"],
    });
  });

  it("no 'tools' entry maps to no-tools", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ capabilities: ["completion"] })),
    );
    const result = await getCapabilities({ name: "m", digest: "d2" }, { baseUrl: "http://x" });
    expect(result).toEqual({ ok: true, value: { status: "no-tools", detail: ["completion"] } });
  });

  it("forceRefresh bypasses a cache hit and still calls fetch", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ capabilities: ["tools"] }));
    vi.stubGlobal("fetch", fetchMock);
    const cache = fakeCache();
    await cache.set("ollama", "d1", { status: "no-tools", detail: [] });

    await getCapabilities(
      { name: "m", digest: "d1" },
      { baseUrl: "http://x", capabilityCache: cache as never, forceRefresh: true },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Content-Type is applied for the POST and wins over a conflicting custom header", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ capabilities: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getCapabilities(
      { name: "m", digest: "d1" },
      { baseUrl: "http://x", headers: [{ key: "Content-Type", value: "text/plain" }] },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});

// ---------------------------------------------------------------------------
// chat() — NDJSON streaming
// ---------------------------------------------------------------------------

async function collect(events: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const e of events) out.push(e);
  return out;
}

function baseParams(overrides: Partial<OllamaChatParams> = {}): OllamaChatParams {
  return {
    model: "llama3.1:8b",
    messages: [{ role: "user", content: "hi" }],
    baseUrl: "http://localhost:11434",
    ...overrides,
  };
}

describe("chat() — NDJSON stream parsing", () => {
  it("parses a well-formed stream: content deltas, tool-calls, then done with stats", async () => {
    const lines = [
      JSON.stringify({ message: { role: "assistant", content: "Hel" }, done: false }),
      JSON.stringify({ message: { role: "assistant", content: "lo" }, done: false }),
      JSON.stringify({
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "get_weather", arguments: { city: "NYC" } } }],
        },
        done: false,
      }),
      JSON.stringify({
        message: { role: "assistant", content: "" },
        done: true,
        done_reason: "stop",
        eval_count: 42,
      }),
    ];
    const body = lines.map((l) => `${l}\n`).join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([enc.encode(body)])),
    );

    const events = await collect(chat(baseParams()));
    expect(events[0]).toEqual({ type: "content", delta: "Hel" });
    expect(events[1]).toEqual({ type: "content", delta: "lo" });
    expect(events[2]).toMatchObject({
      type: "tool-calls",
      toolCalls: [{ function: { name: "get_weather", arguments: { city: "NYC" } } }],
    });
    const toolCallId = (events[2] as { toolCalls: { id?: string }[] }).toolCalls[0]!.id;
    expect(toolCallId).toBeTruthy();
    const done = events[3] as {
      type: string;
      message: { tool_calls?: unknown[] };
      stats: { doneReason?: string; evalCount?: number };
    };
    expect(done.type).toBe("done");
    expect(done.stats.doneReason).toBe("stop");
    expect(done.stats.evalCount).toBe(42);
    // The tool call id on "done"'s message matches the one synthesized for the "tool-calls" event.
    expect(done.message.tool_calls as { id?: string }[] | undefined).toBeUndefined();
  });

  it("reassembles a NDJSON line split across an arbitrary chunk boundary", async () => {
    const line = `${JSON.stringify({ message: { role: "assistant", content: "Hello" }, done: false })}\n`;
    const doneLine = `${JSON.stringify({ message: { role: "assistant", content: "" }, done: true })}\n`;
    const full = line + doneLine;
    const bytes = enc.encode(full);
    // Split mid-line at an arbitrary byte offset, not aligned to `\n`.
    const splitAt = Math.floor(line.length / 2);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([bytes.slice(0, splitAt), bytes.slice(splitAt)])),
    );

    const events = await collect(chat(baseParams()));
    expect(events[0]).toEqual({ type: "content", delta: "Hello" });
    expect(events[1]).toMatchObject({ type: "done" });
  });

  it("flushes a trailing partial line with no terminating newline", async () => {
    const body = JSON.stringify({
      message: { role: "assistant", content: "" },
      done: true,
      done_reason: "stop",
    });
    // No trailing \n at all — server closed the stream mid-line-terminator.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([enc.encode(body)])),
    );

    const events = await collect(chat(baseParams()));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "done" });
  });

  it("a garbage (non-JSON) line mid-stream terminates the generator with a single invalid-response error event", async () => {
    const body =
      JSON.stringify({ message: { role: "assistant", content: "ok" }, done: false }) +
      "\n" +
      "{not valid json at all" +
      "\n" +
      JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) +
      "\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([enc.encode(body)])),
    );

    const events = await collect(chat(baseParams()));
    expect(events[0]).toEqual({ type: "content", delta: "ok" });
    expect(events[1]).toMatchObject({ type: "error", error: { kind: "invalid-response" } });
    // The generator terminates on the parse failure — the later, valid
    // "done" line is never reached.
    expect(events).toHaveLength(2);
  });

  it("an aborted stream (reader.read() rejects with AbortError) yields a single 'aborted' error event", async () => {
    const abortingResponse = {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => Promise.reject(new DOMException("The operation was aborted.", "AbortError")),
          releaseLock: () => undefined,
        }),
      },
    } as unknown as Response;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => abortingResponse),
    );

    const events = await collect(chat(baseParams()));
    expect(events).toEqual([{ type: "error", error: { kind: "aborted" } }]);
  });

  it("a response with no body yields invalid-response and never hangs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const events = await collect(chat(baseParams()));
    expect(events).toEqual([
      {
        type: "error",
        error: { kind: "invalid-response", message: "Response had no body to stream." },
      },
    ]);
  });

  it("maps a 403 mid-chat the same way as listModels (origin rejection)", async () => {
    const fake = createFakeChromeStorage();
    vi.stubGlobal("chrome", fake.chrome);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403 })),
    );
    const events = await collect(chat(baseParams()));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", error: { kind: "unreachable-or-cors" } });
  });

  it("sends tools when provided and omits the field when not", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      streamResponse([enc.encode(`${JSON.stringify({ done: true })}\n`)]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await collect(
      chat(
        baseParams({
          tools: [
            { name: "search", description: "search the web", inputSchema: { type: "object" } },
          ],
        }),
      ),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.tools).toEqual([
      {
        type: "function",
        function: { name: "search", description: "search the web", parameters: { type: "object" } },
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Chaos: unhappy paths the suites above don't cover (card 85,
// .claude/skills/chaos-monkey/SKILL.md).
// ---------------------------------------------------------------------------

describe("chaos: stream faults", () => {
  it("a connection that closes after content but WITHOUT ever sending a done:true line surfaces a terminal invalid-response error, after the content already streamed", async () => {
    // A real-world truncation: the model server crashes, or a proxy in
    // front of it drops the connection, after streaming some tokens but
    // before writing the final `{"done":true,...}` line. Decided card 90:
    // unlike src/infra/openai/index.ts (which always finalizes on stream
    // end and has a `[DONE]` sentinel independent of its own "done" event to
    // tell a clean close from a truncated one), this NDJSON parser has no
    // such independent signal — "the connection closed and we never saw
    // done:true" IS the only evidence of truncation there is — so it is
    // treated as one: the partial content already streamed stays (never
    // discarded), but the generator's last event is a terminal error rather
    // than ending silently as though the reply were complete.
    const body =
      JSON.stringify({ message: { role: "assistant", content: "The answer is" }, done: false }) +
      "\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([enc.encode(body)])),
    );

    const events = await collect(chat(baseParams()));
    expect(events).toEqual([
      { type: "content", delta: "The answer is" },
      {
        type: "error",
        error: {
          kind: "invalid-response",
          message:
            "The connection closed before Ollama sent a completion signal — the reply above may be truncated.",
        },
      },
    ]);
  });

  it("garbage JSON on the final, newline-less line (flush path) still yields a single invalid-response error, not a thrown exception", async () => {
    // Distinct from the existing "garbage line mid-stream" case: this one
    // exercises `chat()`'s POST-loop flush of a trailing partial line (no
    // `\n` at all), the other code path that calls `parseNdjsonLine`.
    const body =
      JSON.stringify({ message: { role: "assistant", content: "ok" }, done: false }) +
      "\n" +
      "{not json, no newline";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([enc.encode(body)])),
    );

    const events = await collect(chat(baseParams()));
    expect(events[0]).toEqual({ type: "content", delta: "ok" });
    expect(events[1]).toMatchObject({ type: "error", error: { kind: "invalid-response" } });
    expect(events).toHaveLength(2);
  });

  it("an abort that fires mid-stream (after some content already arrived) yields 'aborted' without dropping the partial content already yielded", async () => {
    let reads = 0;
    const abortingResponse = {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => {
            reads += 1;
            if (reads === 1) {
              return Promise.resolve({
                done: false,
                value: enc.encode(
                  `${JSON.stringify({
                    message: { role: "assistant", content: "partial" },
                    done: false,
                  })}\n`,
                ),
              });
            }
            return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
          },
          releaseLock: () => undefined,
        }),
      },
    } as unknown as Response;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => abortingResponse),
    );

    const events = await collect(chat(baseParams()));
    expect(events).toEqual([
      { type: "content", delta: "partial" },
      { type: "error", error: { kind: "aborted" } },
    ]);
  });
});

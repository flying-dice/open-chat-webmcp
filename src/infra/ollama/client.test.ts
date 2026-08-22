// Tests for the raw Ollama wire client: NDJSON stream parsing (chunk
// boundaries, garbage lines, abort), capability probing over /api/show, and
// error mapping (including the 403 origin-rejection special case) (card 83).
//
// Card 111 (boards/project-backlog/111-realistic-adapter-tests.md): most of
// this suite now runs against a REAL `node:http` server
// (../testing/http-test-server.ts) instead of a hand-built `Response` over a
// stubbed `fetch` — real chunk boundaries (including one split mid multibyte
// UTF-8 character), a real mid-stream socket destruction for the "connection
// closed without done:true" chaos case, and a real `AbortController` torn
// down against a real socket rather than a fake reader that rejects on cue.
// A few tests deliberately stay on the fetch-stub: pure JSON-envelope shape
// (listModels' normalization) and pure cache logic (getCapabilities' cache
// hit / no-tools / forceRefresh paths never touch the network at all, so
// there is no wire behaviour to be more real about) — ported vs. kept is
// noted per section below and in the card's journal.

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type {
  ModelCapabilities,
  ModelCapabilityCache,
  ProviderError,
} from "../../domain/providers";
import { fail, ok, type Result } from "../../domain/result";
import { createFakeChromeStorage } from "../chrome-storage/testing/fake-chrome-storage";
import { jsonResponse as stubJsonResponse } from "../testing/fetch-stub";
import {
  destroySocket,
  startHttpTestServer,
  useHttpTestServer,
  writeChunks,
} from "../testing/http-test-server";
import {
  chat,
  getCapabilities,
  listModels,
  type OllamaChatParams,
  type OllamaError,
} from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

const enc = new TextEncoder();
const server = useHttpTestServer();

// ---------------------------------------------------------------------------
// listModels
// ---------------------------------------------------------------------------

describe("listModels", () => {
  // KEPT on the fetch-stub: pure JSON-envelope normalization (dropping a
  // malformed model entry, mapping snake_case fields) — no wire behaviour
  // involved, a hand-built Response is exactly as sharp a test as a real one.
  it("normalizes the /api/tags response, GET with no body", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      stubJsonResponse({
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

    const [models, err] = await listModels({ baseUrl: "http://localhost:11434" });
    expect(err).toBeUndefined();
    expect(models).toEqual([
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

  // PORTED: proves a custom header set via decisions/15's `Headers` API
  // actually arrives on a real socket, and that no Content-Type is invented
  // for a bodyless GET — a stubbed `Response` can't tell a header that was
  // set from one that was merely intended.
  it("applies custom headers (decisions/15) on top of no Content-Type for a GET, against a real server", async () => {
    server().route("GET", "/api/tags", ({ res }) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [] }));
    });

    await listModels({
      baseUrl: server().baseUrl,
      headers: [{ key: "X-Gateway-Key", value: "secret" }],
    });

    const [request] = server().requests;
    expect(request?.headers["x-gateway-key"]).toBe("secret");
    expect(request?.headers["content-type"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe("error mapping", () => {
  // PORTED: a real 403 with no body/extra headers, matching what the doc
  // comment on `originRejectedError` says was confirmed against a live
  // Ollama server.
  it("maps a 403 to unreachable-or-cors with the origin-rejection message and a copyable fix (decisions/33)", async () => {
    const fake = createFakeChromeStorage();
    vi.stubGlobal("chrome", fake.chrome);
    server().route("GET", "/api/tags", ({ res }) => {
      res.writeHead(403);
      res.end();
    });

    const [, err] = await listModels({ baseUrl: server().baseUrl });
    expect(err?.kind).toBe("unreachable-or-cors");
    if (err?.kind !== "unreachable-or-cors") return;
    expect(err.message).toContain("rejected this request because of its");
    expect(err.message).toContain("chrome-extension://fake-extension-id");
    expect(err.fix).toEqual({
      label: "Set OLLAMA_ORIGINS, then restart Ollama",
      command: 'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"',
    });
  });

  // PORTED: a real non-2xx status/statusText/body, straight off the wire.
  it("maps a non-403 HTTP error to kind 'http' with status/statusText/body", async () => {
    server().route("GET", "/api/tags", ({ res }) => {
      // Node's http server always sends its own default statusText for a
      // given code unless overridden — set it explicitly so the assertion
      // below is exercising the client's passthrough, not Node's default.
      res.writeHead(500, "Internal Error");
      res.end("server exploded");
    });

    const [, err] = await listModels({ baseUrl: server().baseUrl });
    expect(err).toEqual({
      kind: "http",
      status: 500,
      statusText: "Internal Error",
      body: "server exploded",
    });
  });

  // PORTED: a genuinely dead server (nothing listening on the port anymore)
  // rather than a hand-thrown TypeError — this is the real ECONNREFUSED path
  // `fetch` takes, proving `toOllamaError` classifies undici's actual
  // rejection, not a fabricated stand-in for it.
  it("maps a real dead-server connection failure to unreachable-or-cors with the OLLAMA_ORIGINS fix", async () => {
    const dead = await startHttpTestServer();
    const baseUrl = dead.baseUrl;
    await dead.close(); // nothing listens on this port from here on

    const [, err] = await listModels({ baseUrl });
    expect(err?.kind).toBe("unreachable-or-cors");
    if (err?.kind !== "unreachable-or-cors") return;
    expect(err.fix?.command).toBe("OLLAMA_ORIGINS=chrome-extension://*");
  });

  // PORTED: a real 200 whose body is not JSON.
  it("maps a malformed JSON body to invalid-response", async () => {
    server().route("GET", "/api/tags", ({ res }) => {
      res.writeHead(200);
      res.end("not json");
    });
    const [, err] = await listModels({ baseUrl: server().baseUrl });
    expect(err?.kind).toBe("invalid-response");
  });
});

// ---------------------------------------------------------------------------
// getCapabilities — capability probing over /api/show, digest-cached
// ---------------------------------------------------------------------------

describe("getCapabilities", () => {
  /**
   * An in-memory {@link ModelCapabilityCache}. Typed as the real port rather
   * than handed over as `as never` (card 92): the cast is what let this fake
   * keep returning bare values after the port moved to `Result` tuples, and
   * the only thing that noticed was a runtime `TypeError` deep inside
   * `ollamaFetchJson`. Typed, the compiler notices instead.
   */
  function fakeCache(): ModelCapabilityCache & {
    get: Mock<ModelCapabilityCache["get"]>;
    set: Mock<ModelCapabilityCache["set"]>;
  } {
    const store = new Map<string, ModelCapabilities>();
    return {
      get: vi.fn(async (type, fp) => ok(store.get(`${type}:${fp}`))),
      set: vi.fn(async (type, fp, v) => {
        store.set(`${type}:${fp}`, v);
        return ok();
      }),
    };
  }

  // KEPT: a cache hit never reaches the network at all — nothing here is
  // wire behaviour, so a fetch spy that must never fire is exactly as sharp
  // as it gets.
  it("a cache hit never calls fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const cache = fakeCache();
    await cache.set("ollama", "d1", { status: "tool-capable", detail: [] });

    const result = await getCapabilities(
      { name: "m", digest: "d1" },
      { baseUrl: "http://x", capabilityCache: cache },
    );
    expect(result).toEqual(ok({ status: "tool-capable", detail: [] }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // PORTED: proves the POST really carries `model` as JSON, and that the
  // real response body drives caching — a stubbed fetch can assert the same
  // shape but can't prove the bytes actually round-tripped a socket.
  it("a cache miss POSTs /api/show, maps 'tools' capability to tool-capable, and files the answer, against a real server", async () => {
    server().route("POST", "/api/show", ({ res }) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ capabilities: ["completion", "tools"] }));
    });
    const cache = fakeCache();

    const result = await getCapabilities(
      { name: "llama3.1:8b", digest: "d1" },
      { baseUrl: server().baseUrl, capabilityCache: cache },
    );

    expect(result).toEqual(ok({ status: "tool-capable", detail: ["completion", "tools"] }));
    const [request] = server().requests;
    expect(request?.method).toBe("POST");
    expect(JSON.parse(request?.body.toString() ?? "")).toEqual({ model: "llama3.1:8b" });
    expect(cache.set).toHaveBeenCalledWith("ollama", "d1", {
      status: "tool-capable",
      detail: ["completion", "tools"],
    });
  });

  // KEPT: same reasoning as the cache-hit test above — no capability besides
  // the tool-mapping switch is exercised here that the ported test doesn't
  // already cover on the wire.
  it("no 'tools' entry maps to no-tools", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => stubJsonResponse({ capabilities: ["completion"] })),
    );
    const result = await getCapabilities({ name: "m", digest: "d2" }, { baseUrl: "http://x" });
    expect(result).toEqual(ok({ status: "no-tools", detail: ["completion"] }));
  });

  it("forceRefresh bypasses a cache hit and still calls fetch", async () => {
    const fetchMock = vi.fn(async () => stubJsonResponse({ capabilities: ["tools"] }));
    vi.stubGlobal("fetch", fetchMock);
    const cache = fakeCache();
    await cache.set("ollama", "d1", { status: "no-tools", detail: [] });

    await getCapabilities(
      { name: "m", digest: "d1" },
      { baseUrl: "http://x", capabilityCache: cache, forceRefresh: true },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // PORTED: header precedence (`Content-Type` always wins, decisions/15) is
  // exactly the kind of thing worth proving on a real request — the
  // `Headers` object's own case-insensitive `.set` semantics could mask a
  // bug that only shows up once the request is actually serialized.
  it("Content-Type is applied for the POST and wins over a conflicting custom header, against a real server", async () => {
    server().route("POST", "/api/show", ({ res }) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ capabilities: [] }));
    });

    await getCapabilities(
      { name: "m", digest: "d1" },
      { baseUrl: server().baseUrl, headers: [{ key: "Content-Type", value: "text/plain" }] },
    );

    const [request] = server().requests;
    expect(request?.headers["content-type"]).toBe("application/json");
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

function ndjsonLine(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

describe("chat() — NDJSON stream parsing (real server)", () => {
  it("parses a well-formed stream sent as one real chunk per NDJSON line: content deltas, tool-calls, then done with stats", async () => {
    const lines = [
      ndjsonLine({ message: { role: "assistant", content: "Hel" }, done: false }),
      ndjsonLine({ message: { role: "assistant", content: "lo" }, done: false }),
      ndjsonLine({
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "get_weather", arguments: { city: "NYC" } } }],
        },
        done: false,
      }),
      ndjsonLine({
        message: { role: "assistant", content: "" },
        done: true,
        done_reason: "stop",
        eval_count: 42,
      }),
    ];
    server().route("POST", "/api/chat", async ({ res }) => {
      res.writeHead(200);
      await writeChunks(
        res,
        lines.map((l) => enc.encode(l)),
      );
    });

    const events = await collect(chat(baseParams({ baseUrl: server().baseUrl })));
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
    expect(done.message.tool_calls as { id?: string }[] | undefined).toBeUndefined();
  });

  it("reassembles a NDJSON line split across an arbitrary real chunk boundary", async () => {
    const line = ndjsonLine({ message: { role: "assistant", content: "Hello" }, done: false });
    const doneLine = ndjsonLine({ message: { role: "assistant", content: "" }, done: true });
    const bytes = enc.encode(line + doneLine);
    // Split mid-line at an arbitrary byte offset, not aligned to `\n`.
    const splitAt = Math.floor(line.length / 2);
    server().route("POST", "/api/chat", async ({ res }) => {
      res.writeHead(200);
      await writeChunks(res, [bytes.slice(0, splitAt), bytes.slice(splitAt)]);
    });

    const events = await collect(chat(baseParams({ baseUrl: server().baseUrl })));
    expect(events[0]).toEqual({ type: "content", delta: "Hello" });
    expect(events[1]).toMatchObject({ type: "done" });
  });

  // NEW (card 111 explicitly asks for this case): the split lands INSIDE a
  // multibyte UTF-8 character's byte sequence, not just at an arbitrary text
  // offset — 'é' (U+00E9) encodes as two bytes (0xC3 0xA9); the split below
  // separates them into different chunks. Only catches a real bug because
  // `TextDecoder.decode(chunk, { stream: true })` is what's responsible for
  // buffering a dangling lead byte across chunks — a chunk boundary chosen in
  // JS-string-space (as the pre-card-111 stub did) can never land here.
  it("reassembles a NDJSON line split mid multibyte UTF-8 character", async () => {
    const line = ndjsonLine({ message: { role: "assistant", content: "café" }, done: false });
    const doneLine = ndjsonLine({ message: { role: "assistant", content: "" }, done: true });
    const bytes = enc.encode(line + doneLine);
    const eIndex = line.indexOf("é");
    const prefixByteLength = enc.encode(line.slice(0, eIndex)).length;
    // Split after just the FIRST of 'é'\'s two UTF-8 bytes.
    const splitAt = prefixByteLength + 1;
    server().route("POST", "/api/chat", async ({ res }) => {
      res.writeHead(200);
      await writeChunks(res, [bytes.slice(0, splitAt), bytes.slice(splitAt)]);
    });

    const events = await collect(chat(baseParams({ baseUrl: server().baseUrl })));
    expect(events[0]).toEqual({ type: "content", delta: "café" });
    expect(events[1]).toMatchObject({ type: "done" });
  });

  it("flushes a trailing partial line with no terminating newline", async () => {
    const body = JSON.stringify({
      message: { role: "assistant", content: "" },
      done: true,
      done_reason: "stop",
    });
    server().route("POST", "/api/chat", ({ res }) => {
      res.writeHead(200);
      // No trailing \n at all — server closed the stream mid-line-terminator.
      res.end(body);
    });

    const events = await collect(chat(baseParams({ baseUrl: server().baseUrl })));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "done" });
  });

  it("a garbage (non-JSON) line mid-stream terminates the generator with a single invalid-response error event", async () => {
    const body =
      ndjsonLine({ message: { role: "assistant", content: "ok" }, done: false }) +
      "{not valid json at all\n" +
      ndjsonLine({ message: { role: "assistant", content: "" }, done: true });
    server().route("POST", "/api/chat", ({ res }) => {
      res.writeHead(200);
      res.end(body);
    });

    const events = await collect(chat(baseParams({ baseUrl: server().baseUrl })));
    expect(events[0]).toEqual({ type: "content", delta: "ok" });
    expect(events[1]).toMatchObject({ type: "error", error: { kind: "invalid-response" } });
    // The generator terminates on the parse failure — the later, valid
    // "done" line is never reached.
    expect(events).toHaveLength(2);
  });

  it("a response with no body (real 204) yields invalid-response and never hangs", async () => {
    server().route("POST", "/api/chat", ({ res }) => {
      res.writeHead(204);
      res.end();
    });
    const events = await collect(chat(baseParams({ baseUrl: server().baseUrl })));
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
    server().route("POST", "/api/chat", ({ res }) => {
      res.writeHead(403);
      res.end();
    });
    const events = await collect(chat(baseParams({ baseUrl: server().baseUrl })));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", error: { kind: "unreachable-or-cors" } });
  });

  it("sends tools when provided, with the real request body carrying the converted schema", async () => {
    server().route("POST", "/api/chat", ({ res }) => {
      res.writeHead(200);
      res.end(ndjsonLine({ done: true }));
    });

    await collect(
      chat(
        baseParams({
          baseUrl: server().baseUrl,
          tools: [
            { name: "search", description: "search the web", inputSchema: { type: "object" } },
          ],
        }),
      ),
    );

    const [request] = server().requests;
    const sentBody = JSON.parse(request?.body.toString() ?? "");
    expect(sentBody.tools).toEqual([
      {
        type: "function",
        function: { name: "search", description: "search the web", parameters: { type: "object" } },
      },
    ]);
  });

  it("omits the tools field entirely when none are provided", async () => {
    server().route("POST", "/api/chat", ({ res }) => {
      res.writeHead(200);
      res.end(ndjsonLine({ done: true }));
    });

    await collect(chat(baseParams({ baseUrl: server().baseUrl })));

    const [request] = server().requests;
    const sentBody = JSON.parse(request?.body.toString() ?? "");
    expect(sentBody).not.toHaveProperty("tools");
  });
});

// ---------------------------------------------------------------------------
// Real abort — AbortController torn down against a real socket (card 111
// checklist: "Abort propagation asserted against real sockets").
// ---------------------------------------------------------------------------

describe("chat() — real AbortController against a real socket", () => {
  it("aborting before the request is even sent yields a single 'aborted' error event", async () => {
    server().route("POST", "/api/chat", ({ res }) => {
      res.writeHead(200);
      res.end(ndjsonLine({ done: true }));
    });
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      chat(baseParams({ baseUrl: server().baseUrl, signal: controller.signal })),
    );
    expect(events).toEqual([{ type: "error", error: { kind: "aborted" } }]);
  });

  it("an abort fired mid-stream (after some content already arrived) yields 'aborted' without dropping the partial content already yielded, and the SERVER observes the socket tear down", async () => {
    let releaseServer: () => void = () => undefined;
    const serverSawClose = new Promise<void>((resolve) => {
      releaseServer = resolve;
    });
    server().route("POST", "/api/chat", async ({ res, captured }) => {
      res.writeHead(200);
      await writeChunks(
        res,
        [
          enc.encode(
            ndjsonLine({ message: { role: "assistant", content: "partial" }, done: false }),
          ),
        ],
        { end: false },
      );
      res.once("close", () => {
        releaseServer();
      });
      void captured; // aborted flag is asserted below once the close event settles
    });

    const controller = new AbortController();
    const events: unknown[] = [];
    const iterator = chat(baseParams({ baseUrl: server().baseUrl, signal: controller.signal }));

    const first = await iterator.next();
    expect(first.value).toEqual({ type: "content", delta: "partial" });
    events.push(first.value);

    controller.abort();
    const second = await iterator.next();
    events.push(second.value);
    await serverSawClose;

    expect(events).toEqual([
      { type: "content", delta: "partial" },
      { type: "error", error: { kind: "aborted" } },
    ]);
    const [request] = server().requests;
    expect(request?.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Chaos: unhappy paths the suites above don't cover (card 85,
// .claude/skills/chaos-monkey/SKILL.md). Card 111 ported both of these onto
// a real socket teardown rather than a `ReadableStream.close()`/hand-built
// reader — a clean `close()` and an actual dropped connection are different
// wire events, and the production code has to react correctly to the latter
// too.
// ---------------------------------------------------------------------------

describe("chaos: stream faults (real server)", () => {
  it("a connection that DIES after content but WITHOUT ever sending a done:true line surfaces a terminal invalid-response error, after the content already streamed", async () => {
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
    // A CLEAN close (the server writes content then `res.end()`s normally,
    // no RST) with no `done:true` line ever sent — the real-server analog
    // of the old hand-built `ReadableStream.close()`. `reader.read()`
    // resolves `{done:true}` with no exception, so `chat()`'s own
    // `if (!sawDone)` check is what synthesizes the terminal error, not a
    // caught exception (see the distinct forcible-reset case right below,
    // which DOES throw and is handled by a different branch entirely).
    server().route("POST", "/api/chat", ({ res }) => {
      res.writeHead(200);
      res.end(
        ndjsonLine({ message: { role: "assistant", content: "The answer is" }, done: false }),
      );
    });

    const events = await collect(chat(baseParams({ baseUrl: server().baseUrl })));
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

  // NEW (card 111): distinct from the clean-close-without-done case above —
  // here the connection is forcibly RESET (`destroySocket`) mid-body rather
  // than ending normally, which makes `reader.read()` itself REJECT. That
  // takes chat()'s OUTER catch (the same `toOllamaError` mapping a dead
  // `fetch()` call uses), not the `if (!sawDone)` synthesized-truncation
  // branch above — a real difference in the production code path a
  // hand-built `ReadableStream` has no way to exercise, since cancelling one
  // is always a clean, exception-free close.
  it("a connection FORCIBLY RESET mid-stream (not a clean close) surfaces as a network error, a different path than the clean-close-without-done case above", async () => {
    // Coordinated with the client below: the socket is only destroyed once
    // the client has actually received and parsed the first chunk — a
    // destroy fired too early can race the response's own headers/first
    // bytes off the wire and produce a connection-establishment failure
    // instead of the mid-body reset this test means to exercise.
    let triggerDestroy: () => void = () => undefined;
    const destroySignal = new Promise<void>((resolve) => {
      triggerDestroy = resolve;
    });
    server().route("POST", "/api/chat", async ({ res }) => {
      res.writeHead(200);
      await writeChunks(
        res,
        [
          enc.encode(
            ndjsonLine({ message: { role: "assistant", content: "The answer is" }, done: false }),
          ),
        ],
        { end: false },
      );
      await destroySignal;
      destroySocket(res);
    });

    const iterator = chat(baseParams({ baseUrl: server().baseUrl }));
    const first = await iterator.next();
    expect(first.value).toEqual({ type: "content", delta: "The answer is" });

    triggerDestroy();
    const second = await iterator.next();
    expect(second.value).toMatchObject({ type: "error", error: { kind: "unreachable-or-cors" } });

    const third = await iterator.next();
    expect(third.done).toBe(true);
  });

  it("garbage JSON on the final, newline-less line (flush path) still yields a single invalid-response error, not a thrown exception", async () => {
    // Distinct from the mid-stream garbage-line case above: this one
    // exercises `chat()`'s POST-loop flush of a trailing partial line (no
    // `\n` at all), the other code path that calls `parseNdjsonLine`.
    const body =
      ndjsonLine({ message: { role: "assistant", content: "ok" }, done: false }) +
      "{not json, no newline";
    server().route("POST", "/api/chat", ({ res }) => {
      res.writeHead(200);
      res.end(body);
    });

    const events = await collect(chat(baseParams({ baseUrl: server().baseUrl })));
    expect(events[0]).toEqual({ type: "content", delta: "ok" });
    expect(events[1]).toMatchObject({ type: "error", error: { kind: "invalid-response" } });
    expect(events).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// OllamaError vs ProviderError (card 93, decisions/34)
//
// This module declares the NARROWER vocabulary — `Result<T, OllamaError>` —
// while the `ChatProvider` interface ./adapter.ts implements declares
// `Result<T, ProviderError>`. The two type tests below pin the property that
// makes that free: `Result` is a union of READONLY tuples and so is covariant
// in its error member, which is why ./adapter.ts's `listModels` can pass a
// failure straight through with nothing to map. If `Result` ever stopped
// being readonly, the first case would break and the adapter would silently
// need a translation layer. Pure type-level assertions — no network, no
// server, nothing card 111's realism upgrade touches.
// ---------------------------------------------------------------------------

describe("OllamaError widens into ProviderError", () => {
  it("a Result<T, OllamaError> failure is a Result<T, ProviderError> failure", () => {
    const narrow: Result<string[], OllamaError> = fail({ kind: "aborted" });
    const wide: Result<string[], ProviderError> = narrow;
    expect(wide[1]).toEqual({ kind: "aborted" });
  });

  it("does NOT accept a ProviderError-only kind where an OllamaError is declared", () => {
    // @ts-expect-error `"auth"` is not an OllamaError: Ollama has no concept of authentication, so this client can never produce one and its callers' switches must not have to handle it.
    const bad: Result<string[], OllamaError> = fail({ kind: "auth", status: 401, message: "x" });
    expect(bad[1]).toEqual({ kind: "auth", status: 401, message: "x" });
  });
});

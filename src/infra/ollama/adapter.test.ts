// Tests for the `ChatProvider` adapter over the raw Ollama client — the
// translation at the boundary (message/tool-call shape, error passthrough),
// not a re-test of ./client.test.ts's wire-level coverage (card 83).

import { afterEach, describe, expect, it, vi } from "vitest";
import { createOllamaProvider } from "./adapter";
import { ok } from "../../domain/result";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("createOllamaProvider", () => {
  it("type is 'ollama'", () => {
    const provider = createOllamaProvider({
      id: "p1",
      type: "ollama",
      name: "Local",
      baseUrl: "http://localhost:11434",
    });
    expect(provider.type).toBe("ollama");
  });

  it("listModels maps OllamaModel -> ProviderModel with cacheKey = digest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ models: [{ name: "llama3.1:8b", digest: "sha256:abc", size: 1 }] }),
      ),
    );
    const provider = createOllamaProvider({
      id: "p1",
      type: "ollama",
      name: "Local",
      baseUrl: "http://localhost:11434",
    });

    const result = await provider.listModels();
    expect(result).toEqual(
      ok([{ id: "llama3.1:8b", name: "llama3.1:8b", cacheKey: "sha256:abc" }]),
    );
  });

  it("chat() adapts an inbound tool call and a 'done' event's stats into the shared shape", async () => {
    const line = `${JSON.stringify({
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "search", arguments: { q: "x" } } }],
      },
      done: true,
      done_reason: "stop",
      eval_count: 10,
    })}\n`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(line));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream, { status: 200 })),
    );

    const provider = createOllamaProvider({
      id: "p1",
      type: "ollama",
      name: "Local",
      baseUrl: "http://localhost:11434",
    });

    const events: unknown[] = [];
    for await (const e of provider.chat({ model: "llama3.1:8b", messages: [] })) events.push(e);

    expect(events[0]).toMatchObject({
      type: "tool-calls",
      toolCalls: [{ name: "search", arguments: { q: "x" } }],
    });
    const done = events[1] as {
      type: string;
      stats: { doneReason?: string; raw?: Record<string, unknown> };
    };
    expect(done.type).toBe("done");
    expect(done.stats.doneReason).toBe("stop");
    expect(done.stats.raw?.evalCount).toBe(10);
  });

  it("chat() passes a provider-level error straight through unmodified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const provider = createOllamaProvider({
      id: "p1",
      type: "ollama",
      name: "Local",
      baseUrl: "http://localhost:11434",
    });

    const events: unknown[] = [];
    for await (const e of provider.chat({ model: "m", messages: [] })) events.push(e);
    expect(events).toEqual([
      {
        type: "error",
        error: expect.objectContaining({ kind: "unreachable-or-cors" }),
      },
    ]);
  });
});

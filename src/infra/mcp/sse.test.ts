// Tests for chunk-boundary-safe SSE framing, shared by both MCP HTTP
// transports (card 83).

import { describe, expect, it } from "vitest";
import { createBudget } from "./budget";
import { extractSseMessages, freshSseState, readSseForResponse, scanForResponse } from "./sse";

const enc = new TextEncoder();

describe("extractSseMessages", () => {
  it("parses a single message with an implicit 'message' event", () => {
    const state = freshSseState();
    state.buffer = "data: hello\n\n";
    const messages = extractSseMessages(state);
    expect(messages).toEqual([{ event: "message", data: "hello" }]);
  });

  it("joins multiple data: lines with \\n into one message", () => {
    const state = freshSseState();
    state.buffer = "data: line1\ndata: line2\n\n";
    const messages = extractSseMessages(state);
    expect(messages).toEqual([{ event: "message", data: "line1\nline2" }]);
  });

  it("respects an explicit event: field, resetting to 'message' after dispatch", () => {
    const state = freshSseState();
    state.buffer = "event: endpoint\ndata: /session/abc\n\n" + "data: back-to-default\n\n";
    const messages = extractSseMessages(state);
    expect(messages).toEqual([
      { event: "endpoint", data: "/session/abc" },
      { event: "message", data: "back-to-default" },
    ]);
  });

  it("ignores comment lines (leading ':')", () => {
    const state = freshSseState();
    state.buffer = ": keepalive\ndata: hi\n\n";
    expect(extractSseMessages(state)).toEqual([{ event: "message", data: "hi" }]);
  });

  it("ignores id:/retry: fields", () => {
    const state = freshSseState();
    state.buffer = "id: 5\nretry: 3000\ndata: hi\n\n";
    expect(extractSseMessages(state)).toEqual([{ event: "message", data: "hi" }]);
  });

  it("leaves a trailing partial line buffered for the next call (no flush)", () => {
    const state = freshSseState();
    state.buffer = "data: complete\n\ndata: partia";
    const messages = extractSseMessages(state);
    expect(messages).toEqual([{ event: "message", data: "complete" }]);
    expect(state.buffer).toBe("data: partia");
  });

  it("is chunk-boundary-safe: a message split across two calls with persisted state reassembles correctly", () => {
    const full = 'event: custom\ndata: {"a":1}\n\n';
    const splitAt = Math.floor(full.length / 2);
    const state = freshSseState();

    state.buffer += full.slice(0, splitAt);
    const first = extractSseMessages(state);
    expect(first).toEqual([]); // nothing complete yet

    state.buffer += full.slice(splitAt);
    const second = extractSseMessages(state);
    expect(second).toEqual([{ event: "custom", data: '{"a":1}' }]);
  });

  it("flush:true treats a trailing unterminated line as complete and emits without a closing blank line", () => {
    const state = freshSseState();
    state.buffer = "data: tail-with-no-blank-line";
    const messages = extractSseMessages(state, { flush: true });
    expect(messages).toEqual([{ event: "message", data: "tail-with-no-blank-line" }]);
    expect(state.buffer).toBe("");
  });

  it("strips a trailing \\r (CRLF line endings)", () => {
    const state = freshSseState();
    state.buffer = "data: hi\r\n\r\n";
    expect(extractSseMessages(state)).toEqual([{ event: "message", data: "hi" }]);
  });
});

describe("scanForResponse", () => {
  it("finds the JSON-RPC response matching expectedId, ignoring others", () => {
    const events = [
      { event: "message", data: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "wrong-id" }) },
      { event: "message", data: JSON.stringify({ jsonrpc: "2.0", id: 2, result: "right-id" }) },
    ];
    expect(scanForResponse(events, 2)).toEqual({ jsonrpc: "2.0", id: 2, result: "right-id" });
  });

  it("skips a malformed (non-JSON) event rather than throwing, and keeps scanning", () => {
    const events = [
      { event: "message", data: "{not valid json" },
      { event: "message", data: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }) },
    ];
    expect(scanForResponse(events, 1)).toEqual({ jsonrpc: "2.0", id: 1, result: "ok" });
  });

  it("returns undefined when nothing matches", () => {
    const events = [
      { event: "message", data: JSON.stringify({ jsonrpc: "2.0", id: 99, result: "x" }) },
    ];
    expect(scanForResponse(events, 1)).toBeUndefined();
  });

  it("skips an empty data payload", () => {
    expect(scanForResponse([{ event: "message", data: "" }], 1)).toBeUndefined();
  });
});

describe("readSseForResponse", () => {
  function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
  }

  it("finds the matching response across multiple chunks", async () => {
    const budget = createBudget(1000, undefined);
    const body = streamOf([
      "event: message\ndata: ",
      JSON.stringify({ jsonrpc: "2.0", id: 7, result: { ok: true } }),
      "\n\n",
    ]);
    const result = await readSseForResponse(body, 7, budget);
    budget.cleanup();
    expect(result).toEqual([{ jsonrpc: "2.0", id: 7, result: { ok: true } }, undefined]);
  });

  it("skips a garbage event mid-stream and still finds the real response after it", async () => {
    const budget = createBudget(1000, undefined);
    const body = streamOf([
      "data: not json at all\n\n",
      `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" })}\n\n`,
    ]);
    const result = await readSseForResponse(body, 1, budget);
    budget.cleanup();
    expect(result).toEqual([{ jsonrpc: "2.0", id: 1, result: "ok" }, undefined]);
  });

  it("resolves a failed Result with kind invalid-response when the stream ends with no matching response", async () => {
    const budget = createBudget(1000, undefined);
    const body = streamOf([
      `data: ${JSON.stringify({ jsonrpc: "2.0", id: 99, result: "wrong" })}\n\n`,
    ]);
    const result = await readSseForResponse(body, 1, budget);
    budget.cleanup();
    expect(result).toEqual([
      undefined,
      {
        kind: "invalid-response",
        message: "SSE stream ended without a matching JSON-RPC response.",
      },
    ]);
  });

  it("classifies a budget timeout as kind 'timeout' via budget.classify", async () => {
    const budget = createBudget(5, undefined); // fires almost immediately
    // A real fetch()'d body ties its reader to the request's AbortSignal
    // under the hood, which is what makes a timed-out budget's
    // `controller.abort()` reject an in-flight `reader.read()` in
    // production. A plain, hand-built ReadableStream has to be wired to the
    // same signal explicitly to reproduce that here.
    const neverEndingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        budget.signal.addEventListener("abort", () => {
          controller.error(new DOMException("The operation was aborted.", "AbortError"));
        });
      },
      pull() {
        // never enqueues, never closes on its own — only the abort above ends it
      },
    });
    const [, err] = await readSseForResponse(neverEndingBody, 1, budget);
    budget.cleanup();
    expect(err?.kind).toBe("timeout");
  });
});

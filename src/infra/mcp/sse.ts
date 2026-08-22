// SSE framing (card 76; moved unchanged from src/lib/mcp/client.ts).
//
// Chunk-boundary-safe like src/infra/openai's `extractSseEvents`, generalized
// to also capture the `event:` field — the legacy transport's
// `endpoint`/`message` events depend on it; OpenAI's parser can ignore one
// because OpenAI never sends one.
//
// Both HTTP transports read SSE: Streamable HTTP may answer a single POST
// with an event stream, and the legacy transport's whole downstream channel
// is one. Only the second needs a long-lived pump (./legacy-sse.ts); this
// file is the framing both share plus the one-response read the first uses.

import type { McpResult } from "../../domain/tools";
import type { Budget } from "./budget";
import { isJsonRpcResponse, type JsonRpcResponseMsg } from "./json-rpc";

export interface SseParseState {
  /** Bytes decoded but not yet consumed as a complete line. Persists across reads so a line split across a chunk boundary is assembled correctly. */
  buffer: string;
  /** `event:` value for the message currently being assembled; SSE defaults this to `"message"` and resets it after each dispatch. */
  currentEvent: string;
  /** `data:` line values collected for the message currently being assembled. */
  currentData: string[];
}

export function freshSseState(): SseParseState {
  return { buffer: "", currentEvent: "message", currentData: [] };
}

/**
 * Split whatever's newly available in `state.buffer` into complete SSE
 * messages, in arrival order, leaving any trailing partial line (and any
 * not-yet-terminated message) buffered in `state` for the next call —
 * chunk-boundary-safe at both the line level (`state.buffer`) and the
 * message level (`state.currentEvent`/`state.currentData`), the same
 * two-level persistence src/infra/openai's `extractSseEvents` uses. With
 * `flush: true` (only at end of stream), also treats a trailing unterminated
 * line as complete and emits whatever's accumulated even without a closing
 * blank line.
 */
export function extractSseMessages(
  state: SseParseState,
  opts?: { flush?: boolean },
): { event: string; data: string }[] {
  const messages: { event: string; data: string }[] = [];

  const consumeLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) {
      if (state.currentData.length > 0) {
        messages.push({ event: state.currentEvent, data: state.currentData.join("\n") });
      }
      state.currentData = [];
      state.currentEvent = "message";
      return;
    }
    if (line.startsWith(":")) return; // comment line
    if (line.startsWith("event:")) {
      const value = line.slice(6);
      state.currentEvent = value.startsWith(" ") ? value.slice(1) : value;
      return;
    }
    if (line.startsWith("data:")) {
      const value = line.slice(5);
      state.currentData.push(value.startsWith(" ") ? value.slice(1) : value);
      return;
    }
    // `id:`, `retry:`, or any other field — ignored. Resumability
    // (`Last-Event-ID` replay) is out of scope for this client: every call
    // is a fresh handshake (see ./gateway.ts's module doc), so there is never
    // a previous event id to resume from.
  };

  while (true) {
    const newlineIndex = state.buffer.indexOf("\n");
    if (newlineIndex < 0) break;
    const line = state.buffer.slice(0, newlineIndex);
    state.buffer = state.buffer.slice(newlineIndex + 1);
    consumeLine(line);
  }

  if (opts?.flush) {
    if (state.buffer.length > 0) {
      const trailing = state.buffer;
      state.buffer = "";
      consumeLine(trailing);
    }
    if (state.currentData.length > 0) {
      messages.push({ event: state.currentEvent, data: state.currentData.join("\n") });
      state.currentData = [];
      state.currentEvent = "message";
    }
  }

  return messages;
}

export function scanForResponse(
  events: { event: string; data: string }[],
  expectedId: number,
): JsonRpcResponseMsg | undefined {
  for (const evt of events) {
    if (evt.data.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(evt.data);
    } catch {
      continue; // malformed event on the wire — skip it, keep reading
    }
    if (isJsonRpcResponse(parsed) && parsed.id === expectedId) return parsed;
  }
  return undefined;
}

/** Read an SSE response body looking for the one JSON-RPC response matching `expectedId`, ignoring anything else on the stream (a server-initiated request/notification interleaved on the same stream — not needed since this client declares no server-callable capabilities). Bounded by `budget`: an abort (timeout or caller cancellation) rejects the in-flight `reader.read()`. */
export async function readSseForResponse(
  body: ReadableStream<Uint8Array>,
  expectedId: number,
  budget: Budget,
): Promise<McpResult<JsonRpcResponseMsg>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state = freshSseState();
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        return { ok: false, error: budget.classify(err) };
      }
      if (chunk.done) break;
      state.buffer += decoder.decode(chunk.value, { stream: true });
      const found = scanForResponse(extractSseMessages(state), expectedId);
      if (found) return { ok: true, value: found };
    }
    state.buffer += decoder.decode();
    const found = scanForResponse(extractSseMessages(state, { flush: true }), expectedId);
    if (found) return { ok: true, value: found };
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        message: "SSE stream ended without a matching JSON-RPC response.",
      },
    };
  } finally {
    reader.releaseLock();
  }
}

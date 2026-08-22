// The DEPRECATED transport: protocol version 2024-11-05's HTTP+SSE
// (card 76; moved unchanged from src/lib/mcp/client.ts).
//
// Kept only for backwards compatibility, per the spec's own guidance: a GET
// that opens an event stream, an `endpoint` event naming where to POST, then
// requests POSTed there and responses arriving back down the stream. Reached
// only when the modern transport answered 404/405 to a config on `"auto"`, or
// when a config pins `"sse"` outright (./connect.ts).

import { fail, ok, type Result } from "../../domain/result";
import type { McpError, McpServerConfig } from "../../domain/tools";
import { raceWithBudget, type Budget } from "./budget";
import {
  classifyHttpErrorResponse,
  isJsonRpcResponse,
  authErrorFor,
  toResultFromJsonRpc,
  type JsonRpcResponseMsg,
} from "./json-rpc";
import type { McpClientInfo } from "./protocol";
import { extractSseMessages, freshSseState } from "./sse";
import { initializeParams, validateInitializeResult, type McpWireSession } from "./session";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  readonly settled: boolean;
}

function createDeferred<T>(): Deferred<T> {
  // The two `!` here are DEFINITE-ASSIGNMENT assertions, not non-null
  // assertions on a value (card 96's sweep: production carries zero of the
  // latter). The invariant is the one the Promise constructor guarantees —
  // the executor runs SYNCHRONOUSLY, before `new Promise` returns — so both
  // are assigned by the time anything can read them, and the compiler has no
  // way to see that. The alternative shapes (`| undefined` plus `?.` at every
  // call site, or ES2024's `Promise.withResolvers`, which is past this
  // bundle's es2023 target) cost more than they prove.
  let resolveFn!: (v: T) => void;
  let rejectFn!: (e: unknown) => void;
  let settled = false;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = (v) => {
      settled = true;
      resolve(v);
    };
    rejectFn = (e) => {
      settled = true;
      reject(e);
    };
  });
  return {
    promise,
    resolve: resolveFn,
    reject: rejectFn,
    get settled() {
      return settled;
    },
  };
}

/**
 * Pumps one legacy-transport GET SSE stream in the background, resolving
 * the `endpoint` event once (so the caller learns where to POST) and
 * fulfilling per-request-id waiters as `message` events carrying a matching
 * JSON-RPC response arrive. One instance is created per call (see
 * ./gateway.ts's module doc: no cross-call session reuse), and `close()`d in
 * every code path once that call's single operation is done.
 */
class LegacySsePump {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly baseUrl: string;
  private readonly decoder = new TextDecoder();
  private readonly state = freshSseState();
  private readonly endpointDeferred = createDeferred<string>();
  private readonly waiters = new Map<number, (msg: JsonRpcResponseMsg) => void>();
  private stopped = false;

  // Takes the body STREAM rather than the Response: `connectLegacySse` has
  // already narrowed `response.body` to non-null by the time it constructs
  // this, and passing the narrowed value keeps that fact in the type instead
  // of re-asserting it here.
  constructor(body: ReadableStream<Uint8Array>, baseUrl: string) {
    this.reader = body.getReader();
    this.baseUrl = baseUrl;
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      while (!this.stopped) {
        const { done, value } = await this.reader.read();
        if (done) break;
        this.state.buffer += this.decoder.decode(value, { stream: true });
        this.handle(extractSseMessages(this.state));
      }
      this.state.buffer += this.decoder.decode();
      this.handle(extractSseMessages(this.state, { flush: true }));
    } catch {
      // Stream errored or was cancelled — outstanding waiters are left
      // unresolved deliberately; every waiter is raced against the same
      // call's `budget` via `raceWithBudget`, so nothing hangs past that
      // budget regardless of what happens to this pump.
    } finally {
      if (!this.endpointDeferred.settled) {
        this.endpointDeferred.reject(
          new Error("SSE stream ended before an endpoint event arrived."),
        );
      }
    }
  }

  private handle(events: { event: string; data: string }[]): void {
    for (const evt of events) {
      if (evt.event === "endpoint") {
        if (!this.endpointDeferred.settled) {
          this.endpointDeferred.resolve(new URL(evt.data.trim(), this.baseUrl).toString());
        }
        continue;
      }
      if (evt.data.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(evt.data);
      } catch {
        continue;
      }
      if (!isJsonRpcResponse(parsed) || typeof parsed.id !== "number") continue;
      const waiter = this.waiters.get(parsed.id);
      if (waiter) {
        this.waiters.delete(parsed.id);
        waiter(parsed);
      }
    }
  }

  endpoint(): Promise<string> {
    return this.endpointDeferred.promise;
  }

  waitForResponse(id: number): Promise<JsonRpcResponseMsg> {
    return new Promise((resolve) => {
      this.waiters.set(id, resolve);
    });
  }

  close(): void {
    this.stopped = true;
    this.waiters.clear();
    try {
      void this.reader.cancel();
    } catch {
      // Already closed/errored — nothing left to release.
    }
  }
}

async function postLegacyMessage(
  endpoint: string,
  baseHeaders: Record<string, string>,
  msg: Record<string, unknown>,
  budget: Budget,
): Promise<Result<void, McpError>> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { ...baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(msg),
      signal: budget.signal,
    });
  } catch (err) {
    return fail(budget.classify(err));
  }
  const authErr = await authErrorFor(response);
  if (authErr) return fail(authErr);
  // The spec mandates 202 for an accepted notification/response; be
  // lenient and accept any 2xx here too, since some legacy servers reply
  // 200 to the initial POST instead.
  if (response.ok) return ok();
  return fail(await classifyHttpErrorResponse(response));
}

/**
 * Turn a `raceWithBudget` failure into an `McpError` (card 113). The two arms
 * are always the same question — did the budget RUN OUT, or did the thing we
 * were waiting on end without answering — and only the wording and the
 * non-timeout kind differ per wait, so those are the arguments. Written out
 * three times in this file before, once per wait.
 */
function budgetError(
  err: "timeout" | "other",
  timeoutMessage: string,
  otherError: McpError,
): McpError {
  return err === "timeout" ? { kind: "timeout", message: timeoutMessage } : otherError;
}

export async function connectLegacySse(
  config: McpServerConfig,
  baseHeaders: Record<string, string>,
  clientInfo: McpClientInfo,
  budget: Budget,
): Promise<Result<McpWireSession, McpError>> {
  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "GET",
      headers: { ...baseHeaders, Accept: "text/event-stream" },
      signal: budget.signal,
    });
  } catch (err) {
    return fail(budget.classify(err));
  }

  const authErr = await authErrorFor(response);
  if (authErr) return fail(authErr);
  if (!response.ok) {
    return fail({
      kind: "not-mcp-endpoint",
      message: `Server responded ${response.status} to both the Streamable HTTP and legacy SSE handshake attempts — this doesn't look like an MCP endpoint.`,
    });
  }
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    return fail({
      kind: "not-mcp-endpoint",
      message: "Server did not open an SSE stream for the legacy MCP transport either.",
    });
  }

  const pump = new LegacySsePump(response.body, config.url);

  const [postEndpoint, postEndpointErr] = await raceWithBudget(pump.endpoint(), budget);
  if (postEndpointErr) {
    pump.close();
    return fail(
      budgetError(postEndpointErr, 'Timed out waiting for the legacy SSE "endpoint" event.', {
        kind: "not-mcp-endpoint",
        message: "SSE stream ended before an endpoint event arrived.",
      }),
    );
  }

  let nextId = 2; // id 1 is used for initialize, below.
  const initMsg = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: initializeParams(clientInfo),
  };
  const waitForInit = pump.waitForResponse(1);
  const [, postedErr] = await postLegacyMessage(postEndpoint, baseHeaders, initMsg, budget);
  if (postedErr) {
    pump.close();
    return fail(postedErr);
  }

  const [initResponse, initResponseErr] = await raceWithBudget(waitForInit, budget);
  if (initResponseErr) {
    pump.close();
    return fail(
      budgetError(initResponseErr, "Timed out waiting for the initialize response.", {
        kind: "invalid-response",
        message: "Legacy SSE stream closed before the initialize response arrived.",
      }),
    );
  }

  const [parsedInit, parsedInitErr] = validateInitializeResult(initResponse);
  if (parsedInitErr) {
    pump.close();
    return fail(parsedInitErr);
  }

  const session: McpWireSession = {
    connection: parsedInit,
    async request(method, params) {
      const id = nextId++;
      const waiter = pump.waitForResponse(id);
      const [, sentErr] = await postLegacyMessage(
        postEndpoint,
        baseHeaders,
        { jsonrpc: "2.0", id, method, params: params ?? {} },
        budget,
      );
      if (sentErr) return fail(sentErr);
      const [resp, respErr] = await raceWithBudget(waiter, budget);
      if (respErr) {
        return fail(
          budgetError(respErr, `Timed out waiting for a response to "${method}".`, {
            kind: "invalid-response",
            message: "Legacy SSE stream closed before a response arrived.",
          }),
        );
      }
      return toResultFromJsonRpc(resp);
    },
    async notify(method, params) {
      await postLegacyMessage(
        postEndpoint,
        baseHeaders,
        { jsonrpc: "2.0", method, params: params ?? {} },
        budget,
      );
    },
    close() {
      pump.close();
    },
  };

  await session.notify("notifications/initialized");
  return ok(session);
}

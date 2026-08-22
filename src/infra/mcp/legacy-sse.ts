// The DEPRECATED transport: protocol version 2024-11-05's HTTP+SSE
// (card 76; moved unchanged from src/lib/mcp/client.ts).
//
// Kept only for backwards compatibility, per the spec's own guidance: a GET
// that opens an event stream, an `endpoint` event naming where to POST, then
// requests POSTed there and responses arriving back down the stream. Reached
// only when the modern transport answered 404/405 to a config on `"auto"`, or
// when a config pins `"sse"` outright (./connect.ts).

import type { McpResult, McpServerConfig } from "../../domain/tools";
import { raceWithBudget, type Budget } from "./budget";
import {
  classifyHttpErrorResponse,
  isJsonRpcResponse,
  safeAuthMessage,
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
      reject(e as Error);
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

  constructor(response: Response, baseUrl: string) {
    // `connectLegacySse` already checked `response.body` is present before
    // constructing this.
    this.reader = response.body!.getReader();
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
        this.endpointDeferred.reject(new Error("SSE stream ended before an endpoint event arrived."));
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
): Promise<McpResult<void>> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { ...baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(msg),
      signal: budget.signal,
    });
  } catch (err) {
    return { ok: false, error: budget.classify(err) };
  }
  // TODO: clean-code - 0.3 - DRY: this 401/403 -> {kind:"auth",...} block is repeated here and below, and twice more in streamable-http.ts (four occurrences total) — a classifyAuthStatus(response) helper in json-rpc.ts (already imported by both files) would collapse all four.
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: { kind: "auth", status: response.status, message: await safeAuthMessage(response) },
    };
  }
  // The spec mandates 202 for an accepted notification/response; be
  // lenient and accept any 2xx here too, since some legacy servers reply
  // 200 to the initial POST instead.
  if (response.ok) return { ok: true, value: undefined };
  return { ok: false, error: await classifyHttpErrorResponse(response) };
}

export async function connectLegacySse(
  config: McpServerConfig,
  baseHeaders: Record<string, string>,
  clientInfo: McpClientInfo,
  budget: Budget,
): Promise<McpResult<McpWireSession>> {
  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "GET",
      headers: { ...baseHeaders, Accept: "text/event-stream" },
      signal: budget.signal,
    });
  } catch (err) {
    return { ok: false, error: budget.classify(err) };
  }

  // TODO: clean-code - 0.3 - DRY: this 401/403 -> {kind:"auth",...} block is repeated here and below, and twice more in streamable-http.ts (four occurrences total) — a classifyAuthStatus(response) helper in json-rpc.ts (already imported by both files) would collapse all four.
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: { kind: "auth", status: response.status, message: await safeAuthMessage(response) },
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: {
        kind: "not-mcp-endpoint",
        message: `Server responded ${response.status} to both the Streamable HTTP and legacy SSE handshake attempts — this doesn't look like an MCP endpoint.`,
      },
    };
  }
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    return {
      ok: false,
      error: { kind: "not-mcp-endpoint", message: "Server did not open an SSE stream for the legacy MCP transport either." },
    };
  }

  const pump = new LegacySsePump(response, config.url);

  let postEndpoint: string;
  try {
    postEndpoint = await raceWithBudget(pump.endpoint(), budget);
  } catch (err) {
    pump.close();
    return {
      ok: false,
      error: budget.timedOut()
        ? { kind: "timeout", message: 'Timed out waiting for the legacy SSE "endpoint" event.' }
        : { kind: "not-mcp-endpoint", message: err instanceof Error ? err.message : String(err) },
    };
  }

  let nextId = 2; // id 1 is used for initialize, below.
  const initMsg = { jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams(clientInfo) };
  const waitForInit = pump.waitForResponse(1);
  const posted = await postLegacyMessage(postEndpoint, baseHeaders, initMsg, budget);
  if (!posted.ok) {
    pump.close();
    return posted;
  }

  let initResponse: JsonRpcResponseMsg;
  try {
    initResponse = await raceWithBudget(waitForInit, budget);
  } catch {
    pump.close();
    return {
      ok: false,
      error: budget.timedOut()
        ? { kind: "timeout", message: "Timed out waiting for the initialize response." }
        : { kind: "invalid-response", message: "Legacy SSE stream closed before the initialize response arrived." },
    };
  }

  const parsedInit = validateInitializeResult(initResponse);
  if (!parsedInit.ok) {
    pump.close();
    return parsedInit;
  }

  const session: McpWireSession = {
    connection: parsedInit.value,
    async request(method, params) {
      const id = nextId++;
      const waiter = pump.waitForResponse(id);
      const sent = await postLegacyMessage(postEndpoint, baseHeaders, { jsonrpc: "2.0", id, method, params: params ?? {} }, budget);
      if (!sent.ok) return sent;
      try {
        const resp = await raceWithBudget(waiter, budget);
        return toResultFromJsonRpc(resp);
      } catch {
        return {
          ok: false,
          error: budget.timedOut()
            ? { kind: "timeout", message: `Timed out waiting for a response to "${method}".` }
            : { kind: "invalid-response", message: "Legacy SSE stream closed before a response arrived." },
        };
      }
    },
    async notify(method, params) {
      await postLegacyMessage(postEndpoint, baseHeaders, { jsonrpc: "2.0", method, params: params ?? {} }, budget);
    },
    close() {
      pump.close();
    },
  };

  await session.notify("notifications/initialized");
  return { ok: true, value: session };
}

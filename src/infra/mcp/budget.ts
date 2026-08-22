// The per-call timeout/abort budget (card 76; moved unchanged from
// src/lib/mcp/client.ts).
//
// Per-server failure isolation (decisions/14: a dead server "must never stop
// the page's own tools from being offered") is built on this: every exported
// gateway operation creates ONE budget and signals every `fetch` it makes off
// it, so both an internal timeout and the caller's own `AbortSignal` cancel
// every in-flight request for that call at once, and no other server's call
// is affected.

import type { McpError } from "../../domain/tools";

export interface Budget {
  readonly signal: AbortSignal;
  timedOut(): boolean;
  classify(err: unknown): McpError;
  cleanup(): void;
}

/**
 * One timeout+abort budget for a whole exported call (connect, plus whatever
 * operation follows). `cleanup()` must run in a `finally` — it clears the
 * timer and detaches the listener this adds to the caller's signal.
 */
export function createBudget(ms: number, externalSignal: AbortSignal | undefined): Budget {
  const controller = new AbortController();
  let didTimeOut = false;
  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
  }, ms);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort);
  }
  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    classify(err: unknown): McpError {
      if (err instanceof DOMException && err.name === "AbortError") {
        return didTimeOut
          ? { kind: "timeout", message: `Timed out after ${ms}ms waiting for the MCP server.` }
          : { kind: "aborted" };
      }
      // A blocked CORS preflight (host permission not granted) and a
      // genuinely unreachable host both reject `fetch` with a bare
      // TypeError — mirrors src/infra/openai's `toOpenAiError` and
      // src/infra/ollama's `toOllamaError`: there is no way to tell them
      // apart from here, so the message names both.
      if (err instanceof TypeError) {
        return {
          kind: "unreachable",
          message:
            "Could not reach the configured MCP server. Either the host is down, or this extension hasn't been granted permission to talk to it yet — grant the host permission for this server and try again.",
        };
      }
      return {
        kind: "invalid-response",
        message: err instanceof Error ? err.message : String(err),
      };
    },
    cleanup() {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    },
  };
}

/** Reject `promise` early if `budget.signal` fires before it settles — used to bound waits (e.g. "the legacy transport's endpoint event") that aren't themselves a single `fetch` call. */
export function raceWithBudget<T>(promise: Promise<T>, budget: Budget): Promise<T> {
  if (budget.signal.aborted) {
    return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    budget.signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        budget.signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        budget.signal.removeEventListener("abort", onAbort);
        reject(e as Error);
      },
    );
  });
}

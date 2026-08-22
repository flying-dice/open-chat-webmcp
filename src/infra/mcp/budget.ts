// The per-call timeout/abort budget (card 76; moved unchanged from
// src/lib/mcp/client.ts).
//
// Per-server failure isolation (decisions/14: a dead server "must never stop
// the page's own tools from being offered") is built on this: every exported
// gateway operation creates ONE budget and signals every `fetch` it makes off
// it, so both an internal timeout and the caller's own `AbortSignal` cancel
// every in-flight request for that call at once, and no other server's call
// is affected.

import { fail, ok, type Result } from "../../domain/result";
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

/**
 * Bound a wait on `promise` by `budget.signal` — used for waits (e.g. "the
 * legacy transport's endpoint event") that aren't themselves a single
 * `fetch` call, so they still cancel when the caller's timeout/abort fires.
 *
 * Card 94 (decisions/34-errors-as-values.md): used to reject with a
 * platform-shaped `DOMException` — mirroring `fetch`'s own abort contract so
 * both could share one `catch` — which meant this NEVER-THROWS adapter's one
 * remaining `Promise.reject` (scripts/throw-allowlist.json). It now resolves
 * `Result<T, "timeout" | "other">` instead: `"timeout"` when `budget`'s own
 * timer fired, `"other"` for either an external abort or `promise` itself
 * rejecting (this file's only two callers, ./legacy-sse.ts's endpoint/response
 * waits, never actually reject their promise — that arm exists so this
 * function is total over whatever `promise` a future caller passes). A
 * caller that needs the ORIGINAL rejection reason back has none to recover
 * either way here: both call sites already re-derived their own message from
 * `budget.timedOut()` rather than the exception text.
 */
export async function raceWithBudget<T>(
  promise: Promise<T>,
  budget: Budget,
): Promise<Result<T, "timeout" | "other">> {
  if (budget.signal.aborted) {
    return fail(budget.timedOut() ? "timeout" : "other");
  }
  return new Promise((resolve) => {
    const onAbort = () => {
      resolve(fail(budget.timedOut() ? "timeout" : "other"));
    };
    budget.signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        budget.signal.removeEventListener("abort", onAbort);
        resolve(ok(v));
      },
      () => {
        budget.signal.removeEventListener("abort", onAbort);
        resolve(fail("other"));
      },
    );
  });
}

// The `chrome.runtime` half of invoking a PAGE tool (card 77).
//
// This was the last `chrome.*` call site inside the agent loop
// (src/sidepanel/services/agentLoop.ts's `callPageTool`) — one
// `sendMessage`/response round trip that made an otherwise entirely
// rule-shaped module untestable outside a browser. The loop moved to
// src/domain/chat/turn.ts; this is where its one platform call landed, behind
// `PageToolExecutor`, the port src/domain/tools already declared for exactly
// this shape.
//
// The call chain is side panel → service worker → content relay
// (decisions/02-mainworld-webmcp-bridge.md). Tool descriptors and results are
// UNTRUSTED input from the page: nothing here interpolates either into
// anything that executes — they are only ever passed around as plain data.
//
// NO TIMEOUT LIVES HERE. The outermost rung of the shared ladder
// (src/infra/webmcp/timeouts.mjs) is applied by the domain turn's
// `raceToolCall`, uniformly to whichever kind of tool a turn is calling. This
// adapter's only job is the round trip and the never-throws contract.

import type { MergedToolCallOutcome, PageToolExecutor } from "../../domain/tools";
import type { RuntimeCallToolRequest, RuntimeCallToolResponse } from "./protocol";

/**
 * A {@link PageToolExecutor} bound to one tab. Never throws — every failure
 * path resolves `{ok:false, error}`, the same {@link MergedToolCallOutcome}
 * shape a server tool's executor produces, so the turn needs no branch on
 * kind (decisions/19 §5).
 */
export function createPageToolExecutor(tabId: number): PageToolExecutor {
  return async (name, args, opts): Promise<MergedToolCallOutcome> => {
    if (opts.signal?.aborted) {
      return { ok: false, error: "Stopped by the user before this call ran." };
    }

    const request: RuntimeCallToolRequest = { type: "runtime:call-tool", tabId, name, args };

    try {
      const response = (await chrome.runtime.sendMessage(request)) as
        | RuntimeCallToolResponse
        | undefined;
      if (!response)
        return { ok: false, error: "No response from the extension's background worker." };
      if (!response.ok) {
        return { ok: false, error: response.error ?? "Tool call failed for an unknown reason." };
      }
      return { ok: true, result: response.result };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Tool call failed to reach the page.",
      };
    }
  };
}

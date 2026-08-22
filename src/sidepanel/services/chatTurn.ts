// The side panel's entry point for sending a message — what is left of
// src/sidepanel/services/agentLoop.ts (842 lines) after card 77.
//
// The loop itself is `runTurn` in src/domain/chat: the iteration cap, the
// streaming, the approval gating, the untrusted-content fencing, the
// capture-the-target-session-once guarantee and the tool-call race are all
// rules about a conversation and now live with the conversation. What stays
// here is the only thing that was ever specific to this surface: ASSEMBLING
// THE PORTS the turn runs against.
//
//   `ModelGateway`   — the client the user's current selection resolves to,
//                      passed in by App.svelte's send path.
//   `ToolExecutor`   — this tab's page tools (from the worker's registry, via
//                      ./activeTab.ts) merged with whatever server tools
//                      ./mcpTools.ts currently has cached (decisions/19 §4:
//                      never a fresh network round trip on a turn's critical
//                      path), each page tool bound to
//                      src/infra/chrome-runtime's `createPageToolExecutor`.
//   `ApprovalRequester` — card 09's real approve/deny UI
//                      (src/sidepanel/stores/approvals.svelte.ts), or the
//                      deny-by-default fail-safe.
//
// The `chrome.runtime` round trip that used to sit at the bottom of the loop
// is now behind that port and inside an adapter; nothing in this file talks to
// the platform either.

import {
  chat,
} from "../stores/panel.svelte";
import { denyByDefaultApprovalRequester, type ApprovalRequester, type ToolExecutor } from "../../domain/chat";
import type { ChatProvider } from "../../domain/providers";
import { createPageToolExecutor } from "../../infra/chrome-runtime";
import { getToolsForTab } from "./activeTab";
import { getMergedToolsForTab } from "./mcpTools";

/**
 * The one `ToolExecutor` this surface has. Built once at module scope because
 * it holds nothing — it closes over the two module-level services that own the
 * page-tool lookup and the server-tool cache, and binds a fresh page executor
 * per turn from the tab it is asked about.
 */
const toolExecutor: ToolExecutor = {
  async toolsForTurn(page) {
    const pageTools = await getToolsForTab(page.tabId);
    return getMergedToolsForTab(pageTools, createPageToolExecutor(page.tabId));
  },
};

export interface SendTurnOptions {
  /** The resolved client for the user's current provider selection. `ChatProvider` satisfies the domain's narrower `ModelGateway` structurally — a turn may stream, and may not list models or probe capabilities. */
  provider: ChatProvider;
  model: string;
  tabId: number;
  pageTitle: string;
  pageOrigin: string;
  /**
   * Attach this tab's tools to the turn. Pass `true` ONLY when
   * `selection.activeCapability?.status === "tool-capable"` (decisions/11) —
   * neither this module nor the domain re-checks that; both trust the caller's
   * gate.
   */
  attachTools: boolean;
  /** Defaults to `denyByDefaultApprovalRequester` — the decisions/05 fail-safe: if the real approval UI were somehow never wired in, every call needing approval fails closed. */
  requestApproval?: ApprovalRequester;
}

/**
 * Send `userText` and run the turn to completion. Never throws — every failure
 * mode is surfaced in the transcript, either as a `role:"tool"` result the
 * model reads on the next round or as a plain assistant note for the user.
 */
export function sendTurn(userText: string, opts: SendTurnOptions): Promise<void> {
  return chat.runTurn(userText, {
    model: opts.provider,
    modelId: opts.model,
    tools: toolExecutor,
    approvals: opts.requestApproval ?? denyByDefaultApprovalRequester,
    page: { tabId: opts.tabId, title: opts.pageTitle, origin: opts.pageOrigin },
    attachTools: opts.attachTools,
  });
}

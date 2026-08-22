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
//                      the injected `pageTools` access) merged with whatever
//                      server tools ./mcpTools.ts currently has cached
//                      (decisions/19 §4: never a fresh network round trip on a
//                      turn's critical path), each page tool bound to a
//                      per-tab `PageToolExecutor`.
//   `ApprovalRequester` — card 09's real approve/deny UI
//                      (src/sidepanel/stores/approvals.svelte.ts), or the
//                      deny-by-default fail-safe.
//
// The `chrome.runtime` round trip that used to sit at the bottom of the loop
// is behind a port and inside an adapter (card 77), and as of card 78 this
// module does not name that adapter either: both halves of `pageTools` arrive
// from src/sidepanel/app-services.ts, wired by the composition root.

import {
  denyByDefaultApprovalRequester,
  type ApprovalRequester,
  type PageContextCollector,
  type PageContextSnapshot,
  type ToolExecutor,
} from "../../domain/chat";
import type { ChatProvider } from "../../domain/providers";
import { chat, sidePanelServices } from "../app-services";
import { mergeToolsForTab } from "./mcpTools";

/**
 * The one `ToolExecutor` this surface has. Built once at module scope because
 * it holds nothing — it resolves the wired page-tool access and the
 * server-tool cache per turn, and binds a fresh page executor from the tab it
 * is asked about.
 */
const toolExecutor: ToolExecutor = {
  async toolsForTurn(page) {
    const { pageTools } = sidePanelServices();
    const tools = await pageTools.toolsForTab(page.tabId);
    return mergeToolsForTab(tools, pageTools.executorForTab(page.tabId));
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
  /**
   * decisions/40's sharing gate for the page this turn runs against (card
   * 119, src/sidepanel/stores/pageSharing.svelte.ts). `false` means the user
   * has dismissed sharing: no tools and no page context, whatever else is set
   * here. Passed on to the domain rather than folded into `attachTools`
   * because the two answer different questions and the domain enforces the
   * consent one itself.
   */
  sharingAllowed: boolean;
  /**
   * What the user shared from the page for this turn — a selection first,
   * then the page extract. Recorded as a transcript marker (card 119) and
   * placed in the prompt, fenced as untrusted content (card 120).
   *
   * PASS THE COLLECTOR, NOT ITS RESULT. `collectTurnContext`
   * (../stores/pageSharing.svelte.ts) is a round trip to the tab that can
   * take up to card 118's 3-second rung on a wedged page; handing the
   * function over lets `ChatService.runTurn` put the user's message on screen
   * first and pull afterwards, instead of the composer sitting silent for
   * three seconds. See `PageContextCollector` in src/domain/chat/service.ts.
   */
  pageContext?: readonly PageContextSnapshot[] | PageContextCollector | undefined;
  /** Defaults to `denyByDefaultApprovalRequester` — the decisions/05 fail-safe: if the real approval UI were somehow never wired in, every call needing approval fails closed. */
  requestApproval?: ApprovalRequester;
}

/**
 * Send `userText` and run the turn to completion. Never throws — every failure
 * mode is surfaced in the transcript, either as a `role:"tool"` result the
 * model reads on the next round or as a plain assistant note for the user.
 */
export function sendTurn(userText: string, opts: SendTurnOptions): Promise<void> {
  return chat().runTurn(userText, {
    model: opts.provider,
    modelId: opts.model,
    tools: toolExecutor,
    approvals: opts.requestApproval ?? denyByDefaultApprovalRequester,
    page: { tabId: opts.tabId, title: opts.pageTitle, origin: opts.pageOrigin },
    attachTools: opts.attachTools,
    sharingAllowed: opts.sharingAllowed,
    pageContext: opts.pageContext,
  });
}

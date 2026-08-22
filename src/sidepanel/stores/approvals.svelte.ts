// The real approval UI seam (card 09, boards/project-backlog/09-tool-approval-ux.md;
// decisions/05-tool-approval-policy.md, decisions/17): the implementation of
// `ApprovalRequester`, plumbed into the domain turn from
// src/sidepanel/App.svelte via src/sidepanel/services/chatTurn.ts.
//
// CARD 77: that contract used to be declared in
// src/sidepanel/services/agentLoop.ts and imported back out of it by THIS
// file — its own consumer — so the seam between the loop and the UI lived
// inside one of the two things it was meant to hold apart. `ApprovalRequest`,
// `ApprovalDecision`, `ApprovalRequester` and `denyByDefaultApprovalRequester`
// are now src/domain/chat's, and the auto-run policy units they pair with are
// src/domain/settings's (`pageToolAutoRuns`/`serverToolAutoRuns`, behind
// `ApprovalPolicyGate`).
//
// By the time the turn calls the function this module exports as
// `requestApproval`, that gate has ALREADY decided a human decision is
// required for this specific call — an auto-run outcome under either policy
// never reaches here at all. This module's only remaining job before it has to
// show UI is the session-scoped "don't ask again" skip-list.
//
// Card 38, decisions/20-approval-policy-is-per-tool-source.md: that skip
// list is now TWO independent skip-lists, not one — a page tool's is keyed
// `${pageOrigin}::${toolName}` (unchanged from decisions/05), a server
// tool's is keyed `${serverId}::${toolName}` (never by page origin — a
// remote tool has no relationship to whichever tab happened to be open when
// it was approved). `requestApproval` below is a THIN DISPATCHER that
// resolves a request's source and hands it to `requestPageApproval` or
// `requestServerApproval` — two separately readable functions, each reading
// its own policy setting and writing its own skip-list, sharing no decision
// logic with each other. This is deliberate: a single function branching on
// source internally is exactly the "mangling" decision 20 exists to
// prevent, because that is where the two rules drift back into one.
//
// Everything else is state for src/sidepanel/components/ApprovalCard.svelte
// to render: a plain reactive queue of pending requests, each holding the
// `resolve` function for the promise `requestApproval` handed back to the
// agent loop. `approve`/`deny` are the only way that promise ever settles
// for a UI-shown request.

import type { ApprovalDecision, ApprovalRequest, ApprovalRequester } from "../../domain/chat";
import type { ApprovalPolicy, McpApprovalPolicy } from "../../domain/settings";
import { sidePanelServices } from "../app-services";
import { panel } from "./panel.svelte";
import type { ToolCall } from "../../domain/providers";
import type { MergedTool } from "../../domain/tools";

/** Which skip-list a pending request's "don't ask again" checkbox would write to, if checked — see the module doc comment for why these are two distinct keyspaces that must never mix. `undefined` when no key could be formed (no page origin known — shouldn't happen in practice, a tool call implies an active tab). */
export type SkipTarget =
  | { kind: "page"; key: string }
  | { kind: "server"; key: string }
  | undefined;

export interface PendingApproval {
  id: string;
  call: ToolCall;
  tool: MergedTool | undefined;
  skip: SkipTarget;
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pendingList = $state<PendingApproval[]>([]);
let pagePolicy = $state<ApprovalPolicy>("default");
let mcpPolicy = $state<McpApprovalPolicy>("always-confirm");

const resolvers = new Map<string, (decision: ApprovalDecision) => void>();

/** "Don't ask again for this tool on this page" (decisions/05) — page tools only. In-memory, per side-panel session; never persisted. */
const pageSkipList = new Set<string>();

/** "Don't ask again for this tool on this server" (decisions/20) — server tools only, keyed by server id, NEVER by page origin. Same in-memory, per-session lifetime as {@link pageSkipList}, but a fully separate Set — approving a server's tool is a statement about that server, not about whatever tab happened to be open. */
const serverSkipList = new Set<string>();

export const approvals = {
  /** Pending approval requests, oldest first — src/sidepanel/components/Transcript.svelte renders one ApprovalCard per entry, after the current message list (these calls haven't been added to `panel.messages` yet; the turn only does that once a decision comes back). */
  get pending(): PendingApproval[] {
    return pendingList;
  },
  /** The PAGE tool policy (decisions/05/17) — unrelated to {@link mcpPolicy}. */
  get policy(): ApprovalPolicy {
    return pagePolicy;
  },
  /** The SERVER (MCP) tool policy (decisions/20) — unrelated to {@link policy}. */
  get mcpPolicy(): McpApprovalPolicy {
    return mcpPolicy;
  },
};

/**
 * Load both policies and keep them live for the lifetime of the panel — two
 * independent subscriptions (decisions/20), each firing only for its own
 * setting. Call once, from App.svelte's `onMount`. Returns a single
 * unsubscribe function that tears both down.
 */
export function initApprovalPolicySync(): () => void {
  const settings = sidePanelServices().settings;
  // The error member is dropped on purpose (card 92): both fields already
  // hold the documented default (see their declarations), so an unreadable
  // policy leaves the panel on the conservative setting — which is the same
  // thing the adapter does for a stored value it cannot decode, and the same
  // thing `ApprovalPolicyGate` falls back to when it asks for itself. This
  // copy is only what the approval CARD renders; the gate that decides
  // whether to ask at all reads the store independently.
  void settings.getApprovalPolicy().then(([p]) => {
    if (p) pagePolicy = p;
  });
  void settings.getMcpApprovalPolicy().then(([p]) => {
    if (p) mcpPolicy = p;
  });
  const unsubPage = settings.onApprovalPolicyChange((p) => (pagePolicy = p));
  const unsubMcp = settings.onMcpApprovalPolicyChange((p) => (mcpPolicy = p));
  return () => {
    unsubPage();
    unsubMcp();
  };
}

// ---------------------------------------------------------------------------
// PAGE tool approval — decisions/05/17, unchanged by card 38.
// ---------------------------------------------------------------------------

// TODO: clean-code - 0.25 - COUPLING: reads panel.pageInfo?.origin via a static import of the sibling panel.svelte.ts store rather than through an injected value or a parameter from the caller — one view-state store reaching directly into another's public surface. STAYS: the origin an approval is judged against MUST be the one the panel is showing at the moment the model asks — a value injected at construction, or passed by the caller, is a value that can be stale exactly when it matters (an approval prompt surviving a tab switch is the bug this shape prevents). Reading the live store is the point, not an accident.
function pageSkipKeyFor(toolName: string): string | undefined {
  const origin = panel.pageInfo?.origin;
  return origin ? `${origin}::${toolName}` : undefined;
}

/**
 * decisions/20's PAGE-tool half of the seam. Only ever called for a
 * page-origin (or unresolved) request. Reads/writes `pagePolicy`/
 * `pageSkipList` only — never touches the server policy or skip-list.
 */
function requestPageApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
  const key = pageSkipKeyFor(request.call.name);

  // "always-confirm" means exactly that — it overrides even a tool the user
  // previously marked "don't ask again" on this page.
  if (pagePolicy !== "always-confirm" && key && pageSkipList.has(key)) {
    return Promise.resolve<ApprovalDecision>("approved");
  }

  return new Promise<ApprovalDecision>((resolve) => {
    const id = makeId();
    resolvers.set(id, resolve);
    pendingList = [
      ...pendingList,
      { id, call: request.call, tool: request.tool, skip: key ? { kind: "page", key } : undefined },
    ];
  });
}

// ---------------------------------------------------------------------------
// SERVER (MCP) tool approval — decisions/20, new in card 38. Deliberately a
// SEPARATE function from requestPageApproval above, sharing no logic with
// it, so the two policies can never drift back into one.
// ---------------------------------------------------------------------------

function serverSkipKeyFor(serverId: string, toolName: string): string {
  return `${serverId}::${toolName}`;
}

/**
 * decisions/20's SERVER-tool half of the seam. Only ever called for a
 * server-origin request. Reads/writes `mcpPolicy`/`serverSkipList` only —
 * never touches the page policy or skip-list, and its skip key is scoped to
 * the SERVER (`${serverId}::${toolName}`), never to whatever page happens
 * to be open.
 */
function requestServerApproval(
  request: ApprovalRequest,
  tool: MergedTool,
): Promise<ApprovalDecision> {
  // Defensive: `requestApproval` below only calls this once it has already
  // confirmed `tool.origin.kind === "server"`, so this should be
  // unreachable — but if it somehow weren't, there is no server id to key
  // by, so this falls back to the page path rather than fabricating one.
  if (tool.origin.kind !== "server") return requestPageApproval(request);

  const key = serverSkipKeyFor(tool.origin.serverId, request.call.name);

  // Same "always-confirm overrides skip" rule as the page policy, checked
  // against `mcpPolicy` — NOT `pagePolicy`.
  if (mcpPolicy !== "always-confirm" && serverSkipList.has(key)) {
    return Promise.resolve<ApprovalDecision>("approved");
  }

  return new Promise<ApprovalDecision>((resolve) => {
    const id = makeId();
    resolvers.set(id, resolve);
    pendingList = [
      ...pendingList,
      { id, call: request.call, tool: request.tool, skip: { kind: "server", key } },
    ];
  });
}

// ---------------------------------------------------------------------------
// The dispatcher — resolves source, then hands off. This is the ONLY place
// that looks at `request.tool?.origin.kind`; everything downstream of that
// one branch is a separate, independently readable unit (decisions/20).
// ---------------------------------------------------------------------------

/**
 * The real `ApprovalRequester`, passed as `requestApproval` to
 * the domain turn, via src/sidepanel/services/chatTurn.ts. Only ever called for a call the policy gate
 * has already determined needs a human decision under that tool's OWN
 * policy (see module doc comment) — this never re-derives either
 * auto-run rule itself.
 */
export const requestApproval: ApprovalRequester = (request: ApprovalRequest) => {
  const tool = request.tool;
  if (tool?.origin.kind === "server") {
    return requestServerApproval(request, tool);
  }
  return requestPageApproval(request);
};

function settle(id: string, decision: ApprovalDecision): void {
  const resolve = resolvers.get(id);
  if (!resolve) return; // already settled (e.g. dismissed by dismissAllPending)
  resolvers.delete(id);
  pendingList = pendingList.filter((p) => p.id !== id);
  resolve(decision);
}

/**
 * Approve a pending request. `remember` marks its tool as pre-approved for
 * the rest of this session (decisions/05/20's "don't ask again") — written
 * to whichever skip-list `request.skip.kind` names, checked by the matching
 * `requestPageApproval`/`requestServerApproval` on every later call, unless
 * that source's own policy is later switched to its "always-confirm" value.
 */
export function approve(id: string, remember: boolean): void {
  const entry = pendingList.find((p) => p.id === id);
  if (remember && entry?.skip) {
    if (entry.skip.kind === "page") pageSkipList.add(entry.skip.key);
    else serverSkipList.add(entry.skip.key);
  }
  settle(id, "approved");
}

/** Deny a pending request. */
export function deny(id: string): void {
  settle(id, "denied");
}

/**
 * Resolve every still-pending request as "denied" without touching either
 * skip-list, and clear them from the UI. Call this the instant the user
 * hits Stop (App.svelte's stop handler): src/domain/chat/turn.ts's `raceApproval`
 * already treats an aborted turn's outstanding approval as "denied" so the
 * loop itself unblocks immediately, but it has no way to reach back into
 * THIS module's promise — without this, a card the loop has already moved
 * past would be left showing in the transcript forever, and the promise
 * this module handed out would never settle. Safe to call with nothing
 * pending.
 */
export function dismissAllPending(): void {
  for (const id of [...resolvers.keys()]) settle(id, "denied");
}

// The real approval UI seam (card 09, boards/project-backlog/09-tool-approval-ux.md;
// decisions/05-tool-approval-policy.md), plumbed into
// src/sidepanel/services/agentLoop.ts's `ApprovalRequester` type from
// src/sidepanel/App.svelte.
//
// By the time `runAgentTurn` calls the function this module exports as
// `requestApproval`, `agentLoop.ts`'s `executeToolCall` has ALREADY decided
// (against the same `getApprovalPolicy()` this module also reads) that a
// human decision is required for this specific call — "auto-run-all" and
// the readOnlyHint default never reach here at all. This module therefore
// only has one more thing to check before it has to show UI: the
// session-scoped "don't ask again for this tool on this page" skip-list
// (decisions/05), which the "always-confirm" override takes precedence
// over — that setting means "ask me about literally everything," including
// a tool the user previously waved through.
//
// Everything else is state for src/sidepanel/components/ApprovalCard.svelte
// to render: a plain reactive queue of pending requests, each holding the
// `resolve` function for the promise `requestApproval` handed back to the
// agent loop. `approve`/`deny` are the only way that promise ever settles
// for a UI-shown request.

import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRequester,
} from "../services/agentLoop";
import {
  getApprovalPolicy,
  onApprovalPolicyChange,
  type ApprovalPolicy,
} from "../../lib/settings";
import { panel } from "./panel.svelte";
import type { ToolCall } from "../../lib/provider";
import type { SerializedTool } from "../../lib/protocol";

export interface PendingApproval {
  id: string;
  call: ToolCall;
  tool: SerializedTool | undefined;
  /** `${origin}::${toolName}` this call would be remembered under if the user checks "don't ask again" — `undefined` if no page origin is known (shouldn't happen in practice; a tool call implies an active tab). */
  skipKey: string | undefined;
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
let policy = $state<ApprovalPolicy>("default");

const resolvers = new Map<string, (decision: ApprovalDecision) => void>();

/**
 * "Don't ask again for this tool on this page" (decisions/05) — in-memory
 * only, per side-panel session, keyed `${origin}::${toolName}`. Never
 * persisted: reloading the panel, or navigating cross-origin (which resets
 * the tab's session anyway, decisions/07), clears it.
 */
const skipList = new Set<string>();

export const approvals = {
  /** Pending approval requests, oldest first — src/sidepanel/components/Transcript.svelte renders one ApprovalCard per entry, after the current message list (these calls haven't been added to `panel.messages` yet; agentLoop.ts only does that once a decision comes back). */
  get pending(): PendingApproval[] {
    return pendingList;
  },
  get policy(): ApprovalPolicy {
    return policy;
  },
};

/**
 * Load the current policy and keep it live for the lifetime of the panel.
 * Call once, from App.svelte's `onMount`. Returns an unsubscribe function.
 */
export function initApprovalPolicySync(): () => void {
  void getApprovalPolicy().then((p) => (policy = p));
  return onApprovalPolicyChange((p) => (policy = p));
}

function skipKeyFor(toolName: string): string | undefined {
  const origin = panel.pageInfo?.origin;
  return origin ? `${origin}::${toolName}` : undefined;
}

/**
 * The real `ApprovalRequester`, passed as `requestApproval` to
 * `runAgentTurn` from App.svelte. Only ever called for a call agentLoop.ts
 * has already determined needs a human decision under the current policy
 * (see module doc comment) — this never re-derives "auto-run-all" or the
 * readOnlyHint default itself.
 */
export const requestApproval: ApprovalRequester = (request: ApprovalRequest) => {
  const key = skipKeyFor(request.call.name);

  // "always-confirm" means exactly that — it overrides even a tool the user
  // previously marked "don't ask again" on this page.
  if (policy !== "always-confirm" && key && skipList.has(key)) {
    return Promise.resolve<ApprovalDecision>("approved");
  }

  return new Promise<ApprovalDecision>((resolve) => {
    const id = makeId();
    resolvers.set(id, resolve);
    pendingList = [...pendingList, { id, call: request.call, tool: request.tool, skipKey: key }];
  });
};

function settle(id: string, decision: ApprovalDecision): void {
  const resolve = resolvers.get(id);
  if (!resolve) return; // already settled (e.g. dismissed by dismissAllPending)
  resolvers.delete(id);
  pendingList = pendingList.filter((p) => p.id !== id);
  resolve(decision);
}

/**
 * Approve a pending request. `remember` marks its tool as pre-approved on
 * the current page for the rest of this session (decisions/05's "don't ask
 * again") — checked by the requester above on every later call to the same
 * tool on the same origin, unless the policy is later switched to
 * "always-confirm".
 */
export function approve(id: string, remember: boolean): void {
  const entry = pendingList.find((p) => p.id === id);
  if (remember && entry?.skipKey) skipList.add(entry.skipKey);
  settle(id, "approved");
}

/** Deny a pending request. */
export function deny(id: string): void {
  settle(id, "denied");
}

/**
 * Resolve every still-pending request as "denied" without touching the
 * skip-list, and clear them from the UI. Call this the instant the user
 * hits Stop (App.svelte's stop handler): `agentLoop.ts`'s `raceApproval`
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

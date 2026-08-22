// The two approval policies (decisions/05-tool-approval-policy.md,
// decisions/20-approval-policy-is-per-tool-source.md) and the driven port
// that reads and watches them.
//
// The policies say which VALUES exist and which one an install starts on.
// The decision of whether a specific tool call needs a human — decision 05's
// `readOnlyHint` rule — is card 77's, and lands beside them here when the
// agent loop's auto-run predicates move out of
// src/sidepanel/services/agentLoop.ts.
//
// Decision 20 is why there are two of everything below with nothing shared
// between them. A page tool and a remote MCP server tool are different
// risks: a page's `readOnlyHint` is asserted by something the user is
// looking at and can see the effect of; a server's is asserted by a service
// the user is not looking at, about an effect that may land somewhere
// invisible and authenticated as them. ONE rule for both hides that
// difference — and decision 20 applies that to the STORAGE too, not just to
// the decision logic, so that a future edit to one can never accidentally
// also change the other. The near-duplication below is the point; do not
// factor it into a generic `getPolicy(kind)`.
//
// Every port method rejects with `StorageError` (src/domain/storage) and
// nothing else.

export type ApprovalPolicy = "default" | "always-confirm" | "auto-run-all";

/** "default": auto-run tools annotated `readOnlyHint === true`, prompt for everything else (decision 05). What every install starts on until the user changes it in options. */
export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = "default";

export function isApprovalPolicy(v: unknown): v is ApprovalPolicy {
  return v === "default" || v === "always-confirm" || v === "auto-run-all";
}

export type McpApprovalPolicy = "always-confirm" | "trust-read-only" | "auto-run-all";

/**
 * "always-confirm": every server tool call asks, regardless of
 * `readOnlyHint` — a remote server's self-assertion about itself is not,
 * alone, sufficient grounds to act unseen on the user's behalf (decision
 * 20). This is what every install starts on; a user who trusts their
 * configured servers can opt into `"trust-read-only"` (the page-style rule)
 * from the options page — never the other way around.
 */
export const DEFAULT_MCP_APPROVAL_POLICY: McpApprovalPolicy = "always-confirm";

export function isMcpApprovalPolicy(v: unknown): v is McpApprovalPolicy {
  return v === "always-confirm" || v === "trust-read-only" || v === "auto-run-all";
}

/**
 * Reads, writes and change subscriptions for the two approval policies.
 *
 * A getter never resolves `undefined`: an unset or unrecognisable stored
 * value reads back as the documented default, so no caller has to decide
 * what "no policy" means. The `on*Change` subscriptions exist because these
 * settings genuinely change from OUTSIDE the reading surface — another open
 * options tab, or a value synced in from a different machine on the same
 * Chrome profile — and they hand the callback the same already-defaulted
 * value the getter would.
 */
export interface SettingsStore {
  getApprovalPolicy(): Promise<ApprovalPolicy>;
  setApprovalPolicy(policy: ApprovalPolicy): Promise<void>;
  /** Returns an unsubscribe function. */
  onApprovalPolicyChange(callback: (policy: ApprovalPolicy) => void): () => void;

  getMcpApprovalPolicy(): Promise<McpApprovalPolicy>;
  setMcpApprovalPolicy(policy: McpApprovalPolicy): Promise<void>;
  /** Returns an unsubscribe function. Entirely separate from {@link SettingsStore.onApprovalPolicyChange} (decision 20) — a page-policy change can never fire this callback or vice versa. */
  onMcpApprovalPolicyChange(callback: (policy: McpApprovalPolicy) => void): () => void;
}

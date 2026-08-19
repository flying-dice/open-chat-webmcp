// Approval-policy setting (decisions/05-tool-approval-policy.md) — the
// contract the side panel's approval UI (card 09) reads to decide whether a
// given tool call needs a human's OK before it runs, and that this options
// page (card 13) exposes for the user to change.
//
// Storage: chrome.storage.sync, under SYNC_KEY_APPROVAL_POLICY. This is a
// user preference (like the provider list, decisions/10), not page state or
// a secret, so sync — not local, where chat sessions live
// (decisions/07-session-state-and-persistence.md) — is the right store: it
// follows the user's signed-in Chrome profile across machines.
//
// Deliberately small: a typed policy union, a getter, a setter, and a
// change subscription. The *decision* of whether a specific tool call needs
// approval — decision 05's rule: under "default", `annotations.readOnlyHint
// === true` auto-runs and everything else (including tools with no
// annotations at all) prompts; "always-confirm" prompts for every call;
// "auto-run-all" prompts for none — is card 09's to implement against
// whichever of these three values this module reports. This module only
// stores and reports which one is active; it does not itself judge any
// particular tool call.

export type ApprovalPolicy = "default" | "always-confirm" | "auto-run-all";

/** "default": auto-run tools annotated `readOnlyHint === true`, prompt for everything else (decision 05). What every install starts on until the user changes it in options. */
export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = "default";

const SYNC_KEY_APPROVAL_POLICY = "settings:approvalPolicy";

function isApprovalPolicy(v: unknown): v is ApprovalPolicy {
  return v === "default" || v === "always-confirm" || v === "auto-run-all";
}

/**
 * Read the current approval policy. Defaults to
 * {@link DEFAULT_APPROVAL_POLICY} if nothing has been stored yet, or if
 * what's stored doesn't look like a valid policy (defensive against
 * corrupted or foreign-written storage, same posture as
 * src/lib/providers/registry.ts and src/lib/session.ts).
 */
export async function getApprovalPolicy(): Promise<ApprovalPolicy> {
  const stored = await chrome.storage.sync.get(SYNC_KEY_APPROVAL_POLICY);
  const value = stored[SYNC_KEY_APPROVAL_POLICY];
  return isApprovalPolicy(value) ? value : DEFAULT_APPROVAL_POLICY;
}

/** Persist the approval policy. */
export async function setApprovalPolicy(policy: ApprovalPolicy): Promise<void> {
  await chrome.storage.sync.set({ [SYNC_KEY_APPROVAL_POLICY]: policy });
}

/**
 * Subscribe to changes in the approval policy from anywhere it might change
 * outside this call site — another open options tab, or a value synced in
 * from a different machine signed into the same Chrome profile. Fires with
 * the new, already-defaulted policy (never `undefined`, even if the change
 * cleared the stored value). Returns an unsubscribe function.
 */
export function onApprovalPolicyChange(callback: (policy: ApprovalPolicy) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ) => {
    if (areaName !== "sync") return;
    const change = changes[SYNC_KEY_APPROVAL_POLICY];
    if (!change) return;
    callback(isApprovalPolicy(change.newValue) ? change.newValue : DEFAULT_APPROVAL_POLICY);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// ---------------------------------------------------------------------------
// MCP server approval policy (card 38, decisions/20-approval-policy-is-per-tool-source.md)
//
// Decision 20 supersedes decisions/14's "the approval policy applies
// unchanged to both kinds" and replaces decisions/19 §2's approval
// sentence: a page tool and a remote MCP server tool are different risks —
// a page's `readOnlyHint` is asserted by something the user is looking at
// and can see the effect of; a server's is asserted by a service the user
// is not looking at, about an effect that may land somewhere invisible and
// authenticated as the user. ONE `readOnlyHint`-driven rule for both hides
// that difference. This is therefore a SEPARATE setting with its own
// default, deliberately NOT sharing any code with `ApprovalPolicy` above —
// decision 20's "no shared handles-both function" applies to policy
// STORAGE too, not just the decision logic that reads it, so a future edit
// to one can never accidentally also change the other.
// ---------------------------------------------------------------------------

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

const SYNC_KEY_MCP_APPROVAL_POLICY = "settings:mcpApprovalPolicy";

function isMcpApprovalPolicy(v: unknown): v is McpApprovalPolicy {
  return v === "always-confirm" || v === "trust-read-only" || v === "auto-run-all";
}

/** Read the current MCP server approval policy. Defaults to {@link DEFAULT_MCP_APPROVAL_POLICY} if nothing has been stored yet, or if what's stored doesn't look valid — same defensive posture as {@link getApprovalPolicy}. */
export async function getMcpApprovalPolicy(): Promise<McpApprovalPolicy> {
  const stored = await chrome.storage.sync.get(SYNC_KEY_MCP_APPROVAL_POLICY);
  const value = stored[SYNC_KEY_MCP_APPROVAL_POLICY];
  return isMcpApprovalPolicy(value) ? value : DEFAULT_MCP_APPROVAL_POLICY;
}

/** Persist the MCP server approval policy. */
export async function setMcpApprovalPolicy(policy: McpApprovalPolicy): Promise<void> {
  await chrome.storage.sync.set({ [SYNC_KEY_MCP_APPROVAL_POLICY]: policy });
}

/** Subscribe to changes in the MCP server approval policy — same rationale as {@link onApprovalPolicyChange}, entirely separate listener/key so a page-policy change can never fire this callback or vice versa. */
export function onMcpApprovalPolicyChange(callback: (policy: McpApprovalPolicy) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ) => {
    if (areaName !== "sync") return;
    const change = changes[SYNC_KEY_MCP_APPROVAL_POLICY];
    if (!change) return;
    callback(isMcpApprovalPolicy(change.newValue) ? change.newValue : DEFAULT_MCP_APPROVAL_POLICY);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

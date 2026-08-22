// The two approval policies (decisions/05-tool-approval-policy.md,
// decisions/20-approval-policy-is-per-tool-source.md) and the driven port
// that reads and watches them.
//
// The policies say which VALUES exist and which one an install starts on.
// The decision of whether a specific tool call needs a human — decision 05's
// `readOnlyHint` rule — landed here in card 77, moved out of
// src/sidepanel/services/agentLoop.ts's `shouldAutoRunPageTool` /
// `shouldAutoRunServerTool`. Those two were async only because each re-read
// its policy from the store on every call; the RULE inside each is a pure,
// synchronous function of (policy value, readOnlyHint), so it is written as
// one here and {@link createApprovalPolicyGate} is the thin async wrapper
// that keeps the re-read-every-call behaviour.
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

import type { ToolAnnotations, ToolOrigin } from "../tools";

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

// ---------------------------------------------------------------------------
// "Does this call need a human?" — decision 05's rule for page tools and
// decision 20's for server tools, as TWO separate units (card 77).
//
// Both are pure and synchronous, exactly as the ddd-hexagonal SKILL requires
// of a policy decision: they take the policy VALUE and the tool's own
// `readOnlyHint`, and return a boolean. Nothing here reads a store, awaits, or
// knows which tool list a call came from.
// ---------------------------------------------------------------------------

/** The minimum an approval decision reads off a tool — the narrow view of `MergedTool` (src/domain/tools) that these rules actually need. */
export interface ToolApprovalSubject {
  origin: ToolOrigin;
  annotations: ToolAnnotations;
}

/**
 * Decision 05/17's PAGE-tool rule, unchanged in substance:
 *   - `"auto-run-all"`  → everything runs automatically, no exceptions.
 *   - `"always-confirm"`→ everything asks, INCLUDING a `readOnlyHint` call —
 *     the one case that overrides the annotation-based default.
 *   - `"default"`       → `readOnlyHint === true` runs automatically;
 *     everything else, INCLUDING a tool with no annotations at all, asks
 *     (absence of a hint is treated as mutating, never as safe).
 */
export function pageToolAutoRuns(policy: ApprovalPolicy, readOnlyHint: boolean): boolean {
  return policy === "auto-run-all" || (readOnlyHint && policy !== "always-confirm");
}

/**
 * Decision 20's SERVER-tool rule — independent and stricter, never derived
 * from or sharing logic with {@link pageToolAutoRuns}:
 *   - `"always-confirm"` (the default) → everything asks, REGARDLESS of
 *     `readOnlyHint`: a remote server's self-assertion about itself is not,
 *     alone, grounds to act unseen on the user's behalf.
 *   - `"trust-read-only"` → opt in to the page-style rule.
 *   - `"auto-run-all"`    → everything runs automatically.
 */
export function serverToolAutoRuns(policy: McpApprovalPolicy, readOnlyHint: boolean): boolean {
  if (policy === "auto-run-all") return true;
  if (policy === "trust-read-only") return readOnlyHint;
  return false; // "always-confirm"
}

/**
 * The async face of the two rules above: resolve a call's SOURCE, read THAT
 * source's policy, apply THAT source's rule. A thin dispatcher — never a
 * branch inside a shared function, which is exactly the mangling decision 20
 * exists to prevent.
 *
 * An unresolved (hallucinated) tool has no source to resolve and is judged the
 * PAGE way, matching decision 17's own "absence is mutating, never safe"
 * default: there is no server identity to apply the stricter server rule
 * against, and the page rule already refuses to auto-run an unannotated or
 * unknown call.
 *
 * Reads the store on EVERY call rather than caching per turn — deliberately,
 * and unchanged from the agent loop's behaviour before card 77: a
 * mid-conversation policy change (another open options tab, or a value synced
 * in from another machine) takes effect on the very next call.
 */
export interface ApprovalPolicyGate {
  mayAutoRun(tool: ToolApprovalSubject | undefined): Promise<boolean>;
}

export function createApprovalPolicyGate(store: SettingsStore): ApprovalPolicyGate {
  return {
    async mayAutoRun(tool) {
      const readOnly = tool?.annotations.readOnlyHint === true;
      if (tool?.origin.kind === "server") {
        return serverToolAutoRuns(await store.getMcpApprovalPolicy(), readOnly);
      }
      return pageToolAutoRuns(await store.getApprovalPolicy(), readOnly);
    },
  };
}

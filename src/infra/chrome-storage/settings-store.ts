// `chrome.storage.sync` implementation of `SettingsStore`
// (src/domain/settings) — decisions/05-tool-approval-policy.md,
// decisions/20-approval-policy-is-per-tool-source.md.
//
// SYNC, not local: these are user preferences (like the provider list,
// decisions/10), not page state and not secrets, so they should follow the
// user's signed-in Chrome profile across machines. Chat sessions
// (decisions/07) are the opposite case and live in local.
//
// The two policies share no code here — not the keys, not the readers, not
// the listeners. That is decision 20 applied to storage: "a future edit to
// one can never accidentally also change the other". Resist folding them
// into one `policyEntry(key, isValid, fallback)` helper; the duplication is
// three lines and the coupling it would buy back is the thing the decision
// forbids.

import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_MCP_APPROVAL_POLICY,
  isApprovalPolicy,
  isMcpApprovalPolicy,
  type SettingsStore,
} from "../../domain/settings";
import { subscribeToKey, type StorageAreaGateway } from "./area";

const SYNC_KEY_APPROVAL_POLICY = "settings:approvalPolicy";
const SYNC_KEY_MCP_APPROVAL_POLICY = "settings:mcpApprovalPolicy";

export function createChromeStorageSettingsStore(sync: StorageAreaGateway): SettingsStore {
  return {
    async getApprovalPolicy() {
      const value = await sync.read(SYNC_KEY_APPROVAL_POLICY);
      return isApprovalPolicy(value) ? value : DEFAULT_APPROVAL_POLICY;
    },

    async setApprovalPolicy(policy) {
      await sync.write({ [SYNC_KEY_APPROVAL_POLICY]: policy });
    },

    onApprovalPolicyChange(callback) {
      return subscribeToKey("sync", SYNC_KEY_APPROVAL_POLICY, (newValue) => {
        // Already-defaulted, never `undefined` — a change that CLEARED the
        // stored value still reports the policy that is now in force, so a
        // subscriber never has to duplicate the getter's fallback.
        callback(isApprovalPolicy(newValue) ? newValue : DEFAULT_APPROVAL_POLICY);
      });
    },

    async getMcpApprovalPolicy() {
      const value = await sync.read(SYNC_KEY_MCP_APPROVAL_POLICY);
      return isMcpApprovalPolicy(value) ? value : DEFAULT_MCP_APPROVAL_POLICY;
    },

    async setMcpApprovalPolicy(policy) {
      await sync.write({ [SYNC_KEY_MCP_APPROVAL_POLICY]: policy });
    },

    onMcpApprovalPolicyChange(callback) {
      return subscribeToKey("sync", SYNC_KEY_MCP_APPROVAL_POLICY, (newValue) => {
        callback(isMcpApprovalPolicy(newValue) ? newValue : DEFAULT_MCP_APPROVAL_POLICY);
      });
    },
  };
}

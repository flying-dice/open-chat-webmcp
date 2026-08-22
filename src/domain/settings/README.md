# domain/settings

The `settings` bounded context
(decisions/29-ddd-hexagonal-typescript-layout.md): the **approval policies**
and the decision function that reads them.

Card 74 landed the policies and the `SettingsStore` port; card 77 landed the
decision function.

| Landed / lands here | Comes from | Left behind |
| --- | --- | --- |
| **(card 74)** `ApprovalPolicy` (`default` / `always-confirm` / `auto-run-all`), `McpApprovalPolicy` (`always-confirm` / `trust-read-only` / `auto-run-all`), their defaults and validators, and the `SettingsStore` port | `src/lib/settings.ts` (132 lines, deleted) | its ~13 `chrome.storage.sync` call sites and its `onChange` subscriptions — now `src/infra/chrome-storage/settings-store.ts` behind `SettingsStore` |
| **(card 77)** the "does this tool call need a human?" rule: `pageToolAutoRuns` and `serverToolAutoRuns` (pure, synchronous, one per source), plus `ApprovalPolicyGate` / `createApprovalPolicyGate` — the thin async dispatcher over them that re-reads the store on every call | `src/sidepanel/services/agentLoop.ts`'s `shouldAutoRunPageTool` / `shouldAutoRunServerTool` | the approval queue and its skip-lists, which stay in `src/sidepanel/stores/approvals.svelte.ts`; the `ApprovalRequester` contract itself, which is `src/domain/chat`'s |

Decision 20's separation is load-bearing: the two policies share no keys, no
readers, no listeners and no decision logic, and must not be factored into one
generic `getPolicy(kind)` or one `shouldAutoRun(tool)` that branches on source
internally. `createApprovalPolicyGate` is a dispatcher — it resolves the
source, then hands the whole decision to that source's own function.

The predicates are sync and port-free on purpose (the ddd-hexagonal rule that
pure decisions stay that way): the agent loop's versions were async only
because each re-read its policy first. That re-read is deliberate behaviour —
a mid-conversation policy change takes effect on the very next call — and it
now lives in the one wrapper rather than inside the rule.

Nothing here may import `chrome.*`, `fetch`, the DOM, or Svelte. `index.ts`
is the context's only public face.

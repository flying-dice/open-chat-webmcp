# domain/settings

The `settings` bounded context
(decisions/29-ddd-hexagonal-typescript-layout.md): the **approval policies**
and the decision function that reads them.

Card 74 landed the policies and the `SettingsStore` port. What is still to
come (card 77) is marked below.

| Landed / lands here | Comes from | Left behind |
| --- | --- | --- |
| **(card 74)** `ApprovalPolicy` (`default` / `always-confirm` / `auto-run-all`), `McpApprovalPolicy` (`always-confirm` / `trust-read-only` / `auto-run-all`), their defaults and validators, and the `SettingsStore` port | `src/lib/settings.ts` (132 lines, deleted) | its ~13 `chrome.storage.sync` call sites and its `onChange` subscriptions — now `src/infra/chrome-storage/settings-store.ts` behind `SettingsStore` |
| *(card 77)* the "does this tool call need a human?" rule, and the auto-run predicates (`shouldAutoRunPageTool`, `shouldAutoRunServerTool`) that today decide policy inside the agent loop | `src/sidepanel/services/agentLoop.ts` | the approval queue's UI state, which stays in `src/sidepanel/stores/approvals.svelte.ts` |

Decision 20's separation is load-bearing: the two policies share no keys, no
readers and no listeners, and must not be factored into one generic
`getPolicy(kind)`.

Nothing here may import `chrome.*`, `fetch`, the DOM, or Svelte. `index.ts`
is the context's only public face.

# domain/settings — placeholder

The `settings` bounded context
(decisions/29-ddd-hexagonal-typescript-layout.md): the **approval policies**
and the decision function that reads them.

What lands here (cards 74-79), and from where:

| Lands here | Comes from | Leaves behind |
| --- | --- | --- |
| `ApprovalPolicy` (`default` / `always-confirm` / `auto-run-all`), `McpApprovalPolicy` (`always-confirm` / `trust-read-only` / `auto-run-all`), their defaults and the "does this tool call need a human?" rule | `src/lib/settings.ts` (132 lines) | its ~13 `chrome.storage.sync` call sites and its `onChange` subscriptions — those become a `SettingsStore` adapter in `src/infra/chrome-storage` behind a port declared here |
| the auto-run predicates (`shouldAutoRunPageTool`, `shouldAutoRunServerTool`) that today decide policy inside the agent loop | `src/sidepanel/services/agentLoop.ts` | the approval queue's UI state, which stays in `src/sidepanel/stores/approvals.svelte.ts` |

Nothing here may import `chrome.*`, `fetch`, the DOM, or Svelte. `index.ts`
is the context's only public face.

# infra/chrome-storage — placeholder

The `chrome.storage` side of every driven port: chat persistence, the provider registry, the MCP server registry, and the settings store — including the sync/local **credential split** (secrets and header values never enter `chrome.storage.sync`).

| Lands here | Comes from |
| --- | --- |
| `ChatStore` (`chat:<id>`, `chat:index`, `tabchat:<tabId>`), its 400ms/2000ms write debounce, the 400-chat eviction backstop and the `withIndexLock` index mutex | `src/lib/session.ts` |
| `ProviderRepository` (`providers:list`, `providers:default` on sync; `providers:apiKey:<id>`, `providers:headers:<id>` on local) | `src/lib/providers/registry.ts` |
| `McpServerRepository` (`mcp:servers:list` on sync; `mcp:auth:<id>`, `mcp:headers:<id>` on local) | `src/lib/mcp/registry.ts` |
| `SettingsStore` (`settings:approvalPolicy`, `settings:mcpApprovalPolicy`) plus their `onChange` subscriptions | `src/lib/settings.ts` |
| Ollama's private out-of-registry config store (`ollama:baseUrl`, `ollama:cap:<model>`) | `src/lib/ollama.ts` |

Adapters map their technology's failures INTO the domain's error vocabulary;
nothing in `src/domain/*` ever sees a `DOMException`, an HTTP status, or
`chrome.runtime.lastError`. Only a composition root
(`src/sidepanel/main.ts`, `src/options/main.ts`, `src/background/sw.ts`)
constructs what lives here.

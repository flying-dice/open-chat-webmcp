# infra/chrome-storage

The `chrome.storage` side of every driven storage port: chat persistence, the
provider registry, the MCP server registry, the settings store, and the two
small provider-config stores — including the sync/local **credential split**
(secrets and header values never enter `chrome.storage.sync`).

Landed by card 74. `grep -rn "chrome.storage" src/` returns hits only here,
plus the two sites cards 76/77 own.

| Module | Port it implements | Keys |
| --- | --- | --- |
| `chat-store.ts` | `ChatStore` (`src/domain/chat`) | `chat:<id>`, `chat:index`, `tabchat:<tabId>` — local |
| `provider-registry.ts` | `ProviderRegistry` (`src/domain/providers`) | `providers:list`, `providers:default` — **sync**; `providers:apiKey:<id>`, `providers:headers:<id>` — **local** |
| `mcp-server-registry.ts` | `McpServerRegistry` (`src/domain/tools`) | `mcp:servers:list` — **sync**; `mcp:auth:<id>`, `mcp:headers:<id>` — **local** |
| `settings-store.ts` | `SettingsStore` (`src/domain/settings`) | `settings:approvalPolicy`, `settings:mcpApprovalPolicy` — sync |
| `provider-config-store.ts` | `ProviderDefaultsStore`, `ModelCapabilityCache` (`src/domain/providers`) | `<type>:baseUrl`, `<type>:cap:<fingerprint>` — local (`ollama:baseUrl`, `ollama:cap:<digest>` in practice) |

Three modules exist to stop the above being five copies of the same code:

- **`area.ts`** — the only place `chrome.storage` is actually called, and the
  only place a quota `DOMException` or a `chrome.runtime.lastError` becomes
  a `StorageError` (`src/domain/storage`). Nothing in `src/domain/*` ever
  sees the platform's own error shape.
- **`keyed-record-store.ts`** — the ONE "ordered core list in sync, per-id
  credential parts in local" mechanic. The provider and MCP registries were
  398 and 395 lines of the same idea with the credential split implemented
  twice; both now configure this instead. A credential is a `parts` entry,
  and a part structurally cannot reach the sync area.
- **`ports.ts` / `wiring.ts`** — `createChromeStoragePorts()` builds the
  bundle a composition root holds. `wiring.ts` is the **interim** shared
  bundle every surface imports today; read its header before adding to it —
  cards 77/78 delete it once the UI takes its ports as arguments.

## What did NOT come here

The legacy `session:*` migration. Pre-release means storage shapes are free
to change, so `migrateLegacySessionsOnce`/`runMigration` and the
`chat:migrated-from-tab-sessions:v1` flag were deleted rather than ported
(card 74).

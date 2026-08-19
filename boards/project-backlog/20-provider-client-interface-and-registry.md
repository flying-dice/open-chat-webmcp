---
column: review
labels: [backend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T00:00:00.000Z
---
# Provider client interface and registry

Defines the `ChatProvider` interface (decisions/09-provider-agnostic-chat-transport.md)
that every concrete client (Ollama, OpenAI, future providers) implements, and the
provider-config registry (decisions/10-provider-registry-and-credential-storage.md)
that stores them and resolves the active one. This is the shared contract cards
21-23 build against.

## Checklist

- [x] `ChatProvider` interface: `listModels()`, `getCapabilities(model)`, `chat({model, messages, tools, signal})` streaming
- [x] Provider config type: `{ id, type, name, baseUrl, apiKey?, defaultModel? }`
- [x] Registry CRUD (add/edit/remove/reorder) over `chrome.storage.sync`, `apiKey` split into `chrome.storage.local` keyed by provider id
- [x] Active provider + model resolution used by the side panel and agent loop
- [x] Dangling-provider detection when a session references a removed provider id

## Comments

- **claude** (2026-08-19T17:10:00.000Z): Implemented the shared contract in `src/lib/provider.ts:1-232` — `ChatProvider` (`listModels`/`getCapabilities`/`chat`), `ChatMessage`/`ToolCall` (always-present `id`, generalizing Ollama's id-less calls), `ChatStreamEvent`, `ProviderError`/`ProviderResult<T>` (adds `"auth"` and `"not-supported"` kinds Ollama never produces, alongside Ollama's existing `unreachable-or-cors`/`aborted`/`http`/`invalid-response`), and the three-state `ToolCapabilityStatus`/`ModelCapabilities` moved here per decisions/11. Designed against OpenAI (SSE, call ids, bearer 401, static allowlist) as the harder case per the card brief, not against Ollama's habits.
  Refactored `src/lib/ollama.ts:1-450` to sit behind it: `OllamaError` is now `Extract<ProviderError, ...>` (a structural subset, no conversion needed), `listModels`/`getCapabilities` return `ProviderResult<T>` directly, `ModelCapabilities` is imported from `provider.ts` rather than redefined, and `OllamaToolCall` gained a synthesized `id` (assigned once per call in the NDJSON parser at `src/lib/ollama.ts:355-425`, shared between the `"tool-calls"` event and the terminal `"done"` message for the same call) so the adapter never has to invent call correlation. Renamed the three previously generic exports (`ChatStreamEvent`→`OllamaStreamEvent`, `ChatStats`→`OllamaChatStats`, `ChatParams`→`OllamaChatParams`) to avoid colliding with the new shared names — no consumers existed yet (grepped `src/`), so this was a zero-blast-radius rename. Dropped `describeOllamaError`/`OllamaResult`/the `ollamaClient` bundle as superseded by `describeProviderError`/`ProviderResult`/the new adapter.
  Added the adapter `src/lib/providers/ollama.ts:1-133` (`createOllamaProvider(config)`), translating Ollama's message/tool-call/stream shapes to the shared ones, and the registry `src/lib/providers/registry.ts:1-260` per decisions/10: `ProviderConfig` CRUD (`listProviders`/`getProvider`/`addProvider`/`updateProvider`/`removeProvider`/`reorderProviders`) over `chrome.storage.sync` key `providers:list` (never carries `apiKey`), with `apiKey` split into `chrome.storage.local` under `providers:apiKey:<id>` and merged back in on every read. Default selection (`getDefaultSelection`/`setDefaultSelection`, sync key `providers:default`) plus `resolveSelection`/`resolveProvider` give an explicit `"ok" | "dangling" | "none"` tri-state so a since-deleted provider is never confused with "nothing chosen yet" — reusable for both the global default and a per-tab session's `{providerId, model}` (decisions/07), since they share the `ProviderSelection` shape. `createProviderClient`/`registerProviderType` dispatch a config to its client factory via a registration map (Ollama self-registers at the bottom of `registry.ts:260`) so card 21's OpenAI client only needs to add one `registerProviderType("openai", ...)` line, no edits to existing dispatch logic.
  Verified with `npm run check` (0 errors, 0 warnings) and `npm run build` (green). No existing files imported `src/lib/ollama.ts` yet, so nothing outside these new files was touched.

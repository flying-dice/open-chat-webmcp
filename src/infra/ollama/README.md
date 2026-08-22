# infra/ollama

The Ollama wire client: `/api/tags`, `/api/show`, and the NDJSON streaming `/api/chat`, adapted to the `ChatProvider` port in `src/domain/providers`.

| File | What it is | Landed from (card 75) |
| --- | --- | --- |
| `client.ts` | the raw REST client and its NDJSON stream parser | `src/lib/ollama.ts` (746 lines) |
| `adapter.ts` | `createOllamaProvider`, the thin `ChatProvider` adapter over `client.ts` | `src/lib/providers/ollama.ts` |
| `index.ts` | the barrel — `createOllamaProvider`, `OllamaProviderStores`, `DEFAULT_OLLAMA_BASE_URL` | — |

Its `ollama:baseUrl` / `ollama:cap:<model>` persistence left in card 74: it is
`ProviderDefaultsStore` and `ModelCapabilityCache` (`src/domain/providers`),
implemented in `src/infra/chrome-storage`. `client.ts` takes both as injected
options (`defaults`, `capabilityCache`) — it never imports
`src/infra/chrome-storage` itself, which is what keeps this folder from
breaking `adapters-do-not-import-adapters`. They are supplied at each
surface's interim wiring (`src/sidepanel/lib/providerClients.ts`,
`src/options/lib/providerClients.ts`), which is also where `createOllamaProvider`
is put into the `ProviderType -> ChatProvider` map
(`src/domain/providers/client-factory.ts`) that replaced the old
`registerProviderType`/`createProviderClient` locator.

Adapters map their technology's failures INTO the domain's error vocabulary;
nothing in `src/domain/*` ever sees a `DOMException`, an HTTP status, or
`chrome.runtime.lastError`. Only a composition root
(`src/sidepanel/main.ts`, `src/options/main.ts`, `src/background/sw.ts`)
constructs what lives here — today via the two surfaces' interim wiring
files above, pending real dependency injection in cards 77/78.

# infra/ollama — placeholder

The Ollama wire client: `/api/tags`, `/api/show`, and the NDJSON streaming `/api/chat`, adapted to the `ChatProvider` port in `src/domain/providers`.

| Lands here | Comes from |
| --- | --- |
| the raw REST client and its NDJSON stream parser | `src/lib/ollama.ts` (746 lines) |
| `createOllamaProvider`, the thin `ChatProvider` adapter over it | `src/lib/providers/ollama.ts` |

Its `ollama:baseUrl` / `ollama:cap:<model>` persistence already left, in card
74: it is `ProviderDefaultsStore` and `ModelCapabilityCache`
(`src/domain/providers`), implemented in `src/infra/chrome-storage`. The wire
client takes both as injected options (`defaults`, `capabilityCache`),
supplied today at the one registration site in `src/lib/providers/clients.ts`.
Card 75 must keep them injected — an adapter here importing
`src/infra/chrome-storage` would break `adapters-do-not-import-adapters`.

Adapters map their technology's failures INTO the domain's error vocabulary;
nothing in `src/domain/*` ever sees a `DOMException`, an HTTP status, or
`chrome.runtime.lastError`. Only a composition root
(`src/sidepanel/main.ts`, `src/options/main.ts`, `src/background/sw.ts`)
constructs what lives here.

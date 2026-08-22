# infra/ollama — placeholder

The Ollama wire client: `/api/tags`, `/api/show`, and the NDJSON streaming `/api/chat`, adapted to the `ChatProvider` port in `src/domain/providers`.

| Lands here | Comes from |
| --- | --- |
| the raw REST client and its NDJSON stream parser | `src/lib/ollama.ts` (746 lines) |
| `createOllamaProvider`, the thin `ChatProvider` adapter over it | `src/lib/providers/ollama.ts` |

Its `ollama:baseUrl` / `ollama:cap:<model>` persistence does NOT come with
it — that is storage, and belongs to `src/infra/chrome-storage`. Splitting
transport from persistence is the whole point of moving this module.

Adapters map their technology's failures INTO the domain's error vocabulary;
nothing in `src/domain/*` ever sees a `DOMException`, an HTTP status, or
`chrome.runtime.lastError`. Only a composition root
(`src/sidepanel/main.ts`, `src/options/main.ts`, `src/background/sw.ts`)
constructs what lives here.

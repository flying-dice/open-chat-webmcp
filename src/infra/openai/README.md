# infra/openai — placeholder

The OpenAI-compatible wire client: `/v1/models`, `/v1/chat/completions`, SSE parsing, and bearer/custom-header auth, adapted to the `ChatProvider` port in `src/domain/providers`. Every hosted preset in the catalogue speaks this one client.

| Lands here | Comes from |
| --- | --- |
| the whole wire client, its SSE parser and `createOpenAiProvider` | `src/lib/providers/openai.ts` (762 lines) |

Registration stops being a side-effect import: each composition root wires
this provider type explicitly, which is what removes the latent
"unregistered provider type" throw a new entry point can hit today.

Adapters map their technology's failures INTO the domain's error vocabulary;
nothing in `src/domain/*` ever sees a `DOMException`, an HTTP status, or
`chrome.runtime.lastError`. Only a composition root
(`src/sidepanel/main.ts`, `src/options/main.ts`, `src/background/sw.ts`)
constructs what lives here.

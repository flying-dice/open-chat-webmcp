# infra/openai

The OpenAI-compatible wire client: `/v1/models`, `/v1/chat/completions`, SSE parsing, and bearer/custom-header auth, adapted to the `ChatProvider` port in `src/domain/providers`. Every hosted preset in the catalogue speaks this one client.

| File | What it is | Landed from (card 75) |
| --- | --- | --- |
| `index.ts` | the whole wire client, its SSE parser, `createOpenAiProvider` and `DEFAULT_OPENAI_BASE_URL` | `src/lib/providers/openai.ts` (762 lines) |

Registration is no longer a side-effect import: this module used to call
`registerProviderType("openai", createOpenAiProvider)` at its own bottom, on
import, since the old locator (`src/lib/providers/clients.ts`) was off-limits
to the card that first landed this client. That locator is deleted. Each
surface's interim wiring (`src/sidepanel/lib/providerClients.ts`,
`src/options/lib/providerClients.ts`) now imports `createOllamaProvider` and
`createOpenAiProvider` directly and puts them in an exhaustive
`Record<ProviderType, ...>` (`src/domain/providers/client-factory.ts`) — a
third provider type with no entry there is a compile error, not a runtime
"unregistered type" throw.

Adapters map their technology's failures INTO the domain's error vocabulary;
nothing in `src/domain/*` ever sees a `DOMException`, an HTTP status, or
`chrome.runtime.lastError`. Only a composition root
(`src/sidepanel/main.ts`, `src/options/main.ts`, `src/background/sw.ts`)
constructs what lives here — today via the two surfaces' interim wiring
files above, pending real dependency injection in cards 77/78.

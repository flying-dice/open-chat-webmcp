# infra/webmcp — placeholder

The page-tool bridge: the ISOLATED-world content relay that reads `document.modelContext`, plus the service worker's per-tab tool registry that fronts it.

| Lands here | Comes from |
| --- | --- |
| `document.modelContext.getTools()` reading, the live-tool cache, `ontoolchange`/`pageshow` refresh and the 20s execute timeout | `src/content/relay.ts` (451 lines) |
| the in-memory per-tab tool registry, its invalidation on nav/remove, and the live rebuild on a registry miss | `src/background/sw.ts` (422 lines — the listener wiring stays in `sw.ts` as its composition root) |

The timeout ladder (relay 20s < worker 30s) is duplicated in three
unsynchronised constants today, one of them in `verify/run.mjs`; it becomes
one exported constant here.

Adapters map their technology's failures INTO the domain's error vocabulary;
nothing in `src/domain/*` ever sees a `DOMException`, an HTTP status, or
`chrome.runtime.lastError`. Only a composition root
(`src/sidepanel/main.ts`, `src/options/main.ts`, `src/background/sw.ts`)
constructs what lives here.

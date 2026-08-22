# infra/chrome-runtime

The `chrome.runtime` / `chrome.tabs` / `chrome.permissions` side: the cross-context message protocol and every capability the extension asks the browser for.

| Status | What | From |
| --- | --- | --- |
| landed (card 73) | the six-message protocol, `isRuntimeMessage`, and typed send/receive helpers | `src/lib/protocol.ts` — deleted outright by card 76 once its last re-export importer was gone (the tool DESCRIPTOR types it used to own moved to `src/domain/tools` in card 73) |
| landed (card 77) | `createPageToolExecutor` — the `runtime:call-tool` round trip (panel → worker → relay) behind `src/domain/tools`'s `PageToolExecutor` port | `src/sidepanel/services/agentLoop.ts`'s `callPageTool`, the last `chrome.*` call inside the agent loop. The timeout race did NOT come with it: the ladder's outermost rung is applied by the domain turn, uniformly to page and server tools alike |
| landed (card 78) | `permissions.ts` — `createChromeHostPermissions()`, the one implementation of `HostPermissions` (`src/domain/permissions`), including the `onAdded`/`onRemoved` subscription the two options sections used to make themselves | `src/lib/permissions.ts`, plus the surviving re-export shim `src/options/lib/permissions.ts` (both deleted). `originPatternForUrl` went the OTHER way, into `src/domain/permissions` — it is pure URL parsing, and every caller that only validates a URL now asks the domain |
| landed (card 78) | `tab-sync.ts` — active-tab tracking, tab-switch vs. same-tab cross-origin-nav discrimination, the serialization queue and staleness guards, and the `runtime:get-tools` lookup (also exported on its own as `createTabToolsLookup`, for a turn's page tools) | `src/sidepanel/services/activeTab.ts` (~20 `chrome.*` sites, deleted). Card 77 moved the CONSEQUENCE of a tab switch into `src/domain/chat`'s `ChatService`; this is the listening itself. It takes `TabSyncSession` (three `ChatService` methods, structurally) and `TabSyncView` (where a resolved page lands) as arguments, so it names neither the domain service nor the panel store |
| landed (card 118) | `page-context-source.ts` — `createPageContextSource()`, the `runtime:get-page-context` round trip (panel → worker → relay) behind `src/domain/chat`'s `PageContextSource` port, plus the request/response pair itself in `protocol.ts` (decisions/40-page-context-access.md) | new. The DOM walk it carries is NOT here: extracting text from a `Document` is `src/infra/dom/page-extraction.ts`, a pure pair of functions the relay composes — this folder owns the messaging, that one owns the document |
| landed (card 78) | `extension-shell.ts` — `chrome.runtime.openOptionsPage()`, the side panel's "provider CRUD lives on the options page" affordance (decisions/10) | `src/sidepanel/stores/selection.svelte.ts`'s last `chrome.*` site |

## `chrome.identity` does NOT land here

This README used to list `chrome.identity.launchWebAuthFlow` as arriving from
`src/lib/mcp/oauth.ts`, on the "every capability the extension asks the
browser for" principle. Card 76 kept it in `src/infra/mcp` instead, and that
is now the settled answer:

- The three call sites (`getRedirectURL`, the availability guard, and
  `launchWebAuthFlow` itself) are inseparable from the PKCE flow around them.
  The `state` parameter is generated, sent and re-validated across that one
  call; splitting it out would put half of an anti-CSRF check in each folder.
- `adapters-do-not-import-adapters` means `src/infra/mcp` could not simply
  call a helper here — it would need a port of its own, in the domain, whose
  entire content is "open this URL and give me back the redirect". That is a
  port modelling a browser API rather than a domain need.

`chrome.identity` is therefore contained to `src/infra/mcp/oauth.ts`, and
`scripts/guard-boundaries.mjs` enforces exactly that.

Adapters map their technology's failures INTO the domain's error vocabulary;
nothing in `src/domain/*` ever sees a `DOMException`, an HTTP status, or
`chrome.runtime.lastError`. Only a composition root
(`src/sidepanel/main.ts`, `src/options/main.ts`, `src/background/sw.ts`,
`src/content/relay.ts`) constructs what lives here — enforced since card 78 by
`only-roots-construct-infra` in `.dependency-cruiser.cjs`.

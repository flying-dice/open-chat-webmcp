# infra/chrome-runtime

The `chrome.runtime` / `chrome.tabs` / `chrome.permissions` side: the cross-context message protocol and every capability the extension asks the browser for.

| Status | What | From |
| --- | --- | --- |
| landed (card 73) | the six-message protocol, `isRuntimeMessage`, and typed send/receive helpers | `src/lib/protocol.ts` — deleted outright by card 76 once its last re-export importer was gone (the tool DESCRIPTOR types it used to own moved to `src/domain/tools` in card 73) |
| landed (card 77) | `createPageToolExecutor` — the `runtime:call-tool` round trip (panel → worker → relay) behind `src/domain/tools`'s `PageToolExecutor` port | `src/sidepanel/services/agentLoop.ts`'s `callPageTool`, the last `chrome.*` call inside the agent loop. The timeout race did NOT come with it: the ladder's outermost rung is applied by the domain turn, uniformly to page and server tools alike |
| pending (card 78) | `originPatternForUrl`, `hasHostPermission`, `requestHostPermission` — and the deletion of the surviving re-export shim `src/options/lib/permissions.ts` (the MCP-side twin `src/lib/mcp/permissions.ts` is already gone, card 76) | `src/lib/permissions.ts` |
| pending (card 78) | active-tab tracking, tab-switch vs. same-tab cross-origin-nav discrimination, and the `runtime:get-tools` lookup | `src/sidepanel/services/activeTab.ts` (~17 `chrome.*` sites). Card 77 moved the CONSEQUENCE of a tab switch into `src/domain/chat`'s `ChatService`; what is left in that file is the `chrome.tabs`/`chrome.runtime` listening itself, which is what belongs here |

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
(`src/sidepanel/main.ts`, `src/options/main.ts`, `src/background/sw.ts`)
constructs what lives here.

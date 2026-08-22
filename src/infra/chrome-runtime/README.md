# infra/chrome-runtime — placeholder

The `chrome.runtime` / `chrome.tabs` / `chrome.permissions` / `chrome.identity` side: the cross-context message protocol and every capability the extension asks the browser for.

| Lands here | Comes from |
| --- | --- |
| the six-message protocol, `isRuntimeMessage`, and typed send/receive helpers | `src/lib/protocol.ts` (the tool DESCRIPTOR types it used to own already moved to `src/domain/tools` in card 73) |
| `originPatternForUrl`, `hasHostPermission`, `requestHostPermission` — and the deletion of the two re-export shims (`src/lib/mcp/permissions.ts`, `src/options/lib/permissions.ts`) | `src/lib/permissions.ts` |
| active-tab tracking, tab-switch vs. same-tab cross-origin-nav discrimination | `src/sidepanel/services/activeTab.ts` (~17 `chrome.*` sites) |
| `chrome.identity.launchWebAuthFlow` | `src/lib/mcp/oauth.ts` (the browser half; the protocol half goes to `src/infra/mcp`) |

Adapters map their technology's failures INTO the domain's error vocabulary;
nothing in `src/domain/*` ever sees a `DOMException`, an HTTP status, or
`chrome.runtime.lastError`. Only a composition root
(`src/sidepanel/main.ts`, `src/options/main.ts`, `src/background/sw.ts`)
constructs what lives here.

# WebMCP compatibility

[WebMCP](https://github.com/webmachinelearning/webmcp) lets a web page
register tools an AI agent can call, on `document.modelContext`. There is
exactly one case this extension supports: **the browser itself implements
`document.modelContext` natively, and the page registers tools directly
against it.** That's it. There is no polyfill support and no fallback
implementation any more — see
[decisions/16](../decisions/16-native-webmcp-client.md).

This is a hard trade, not an incremental one, and it's worth stating plainly
what it costs and what it buys, since it reverses an earlier design
(`decisions/02-mainworld-webmcp-bridge.md`, superseded).

## What changed, and why

The extension used to inject a MAIN-world script (`src/inject/bridge.ts`,
555 lines, now deleted) that installed an "adopt-or-provide" shim on
`navigator.modelContext`: adopt whatever was already there (native or a
polyfill), or provide an implementation itself if nothing was. The
justification at the time was that there was no way to *read* a native
implementation's registered tools from outside the page's own JS world.

That premise stopped being true. `document.modelContext` — the API moved
from `navigator.modelContext` in a 2026-05-27 spec migration — is a genuine
`Document`-scoped WebIDL attribute, which means an ISOLATED-world content
script (the kind every other browser extension uses, including the official
WebMCP inspector) can read it directly, with `getTools()`, `ontoolchange`,
and `executeTool()`. This was measured directly against Chrome 151/152, not
assumed from the spec text — see
[decisions/16](../decisions/16-native-webmcp-client.md) for the full list of
places Chrome's shipped behaviour disagrees with the published IDL.

Reading the same registry the browser itself maintains, instead of running a
parallel implementation next to it, is what makes the extension
**interoperable**: this extension and the official WebMCP inspector, loaded
in the same browser on the same page, see the identical tool set — verified
directly, both extensions live at once, in card 43's journal. Under the old
shim, the inspector saw nothing on pages this extension found six tools on,
because the inspector reads the native registry and the shim was a separate
object entirely.

## What this costs

**Pages relying on a JS polyfill are now invisible to us.** A polyfill such
as `@mcp-b/global` installs `document.modelContext` in the page's own MAIN
world. An ISOLATED-world content script — which is all this extension is,
now — cannot see anything installed in the MAIN world; there is no bridge
left to cross that boundary. A page that used to work through the shim's
"adopt" path now shows no tools at all. Reintroducing support would mean
reintroducing a MAIN-world script, which is exactly what decisions/16
deliberately chose not to do.

**Pages with no WebMCP support of their own are no longer given one.** The
old shim's "provide" mode meant a page could call
`navigator.modelContext.registerTool(...)` blind, with no polyfill and no
native support, and it would just work — the shim silently became the
implementation. That mode is gone. A page like that now throws, exactly as
it would with no extension installed at all. This is treated as correct
behaviour, not a regression to route around: the extension no longer
provides an implementation to any page, it only reads one the browser
already provides.

**Native WebMCP is a hard requirement**, and it is off by default. See
[Turning it on](#turning-it-on) below.

## Turning it on

`document.modelContext` does not exist in a stock installation of Chrome
today. It's enabled one of three ways:

1. **The `chrome://flags/#enable-webmcp-testing` toggle** ("WebMCP for
   testing"), then relaunch Chrome. `npm run launch` opens this flags page
   for you on first run — see the README.
2. **`--enable-features=WebMCP`** as a Chrome launch flag. This is how
   `npm run verify` runs its harness (on Chrome for Testing, since branded
   Google Chrome ignores `--load-extension` outright).
3. **A WebMCP origin-trial (OT) token embedded in the page itself**, as a
   `<meta http-equiv="origin-trial" content="...">` tag or an equivalent
   response header. A site carrying a valid token gets `document.modelContext`
   in any visitor's stock Chrome within the trial's window, no flag needed on
   the visitor's end at all.

Case 3 explains an observation that looks confusing until you know it: the
Chrome team's own demo pages at
[googlechromelabs.github.io/webmcp-tools](https://googlechromelabs.github.io/webmcp-tools)
work in a completely stock Chrome, flag off, while a local demo page does
not. Their HTML carries an origin-trial token — decoded, it reads
`{"origin":"https://googlechromelabs.github.io:443","feature":"WebMCP","expiry":1794873600}`
— scoped to that exact origin. It is not that WebMCP is broadly available and
your local setup is missing something; it's that this one origin has a token
and yours doesn't. This was the original source of confusion that started
this whole migration: the extension looked broken on a local demo page while
appearing to work fine on Google's own demos, and the actual difference was
never the extension at all.

The origin trial itself runs Chrome 149–156. `manifest.config.ts`'s
`minimum_chrome_version` is set to `149` to match.

## The "WebMCP unavailable" state

Because native WebMCP is a hard requirement now, a disabled flag needs to
look different in the UI from a page that simply has no tools — otherwise
every user without the flag on would see an ordinary-looking empty state and
have no idea anything was even missing.

The relay (`src/content/relay.ts`) checks `document.modelContext !==
undefined` once, at load, and reports that as `available: boolean` alongside
the tool list. This is threaded end to end: relay →
`runtime:tools-updated`/`runtime:get-tools-response` → the service worker's
per-tab registry (`src/background/sw.ts`) → the panel's `PageInfo.webmcpAvailable`.
The panel's tools view (`src/sidepanel/components/ToolsPanel.svelte`) branches
on it first: `webmcpAvailable === false` shows an explanatory message naming
the flag and the origin-trial alternative, distinct from the ordinary "this
page hasn't published any tools" copy shown when `webmcpAvailable === true`
and the list is simply empty.

## Out of scope: iframes

The relay only injects into the **top frame** (`all_frames: false` in
`manifest.config.ts`). A page that publishes tools from an embedded
iframe — a checkout widget, an embedded dashboard — is invisible to the
extension entirely; there is no fallback or partial support for this case.

Unlike when this was originally deferred, the *platform* question — what
tool identity means across frames — is no longer open. The native API
defines it: `registerTool`'s `exposedTo` option and `getTools`'s
`fromOrigins` filter control cross-frame visibility, and each
`RegisteredTool` carries its own `origin` and `window` identifying the frame
that registered it (this relay already uses the latter to scope its own
top-frame lookups — see [Architecture](01-architecture.md)). What's still
undecided is whether it's worth injecting into every frame on every page to
use those primitives. See
`boards/project-backlog/18-iframe-tool-discovery.md`.

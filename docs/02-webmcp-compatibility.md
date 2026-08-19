# WebMCP compatibility

[WebMCP](https://github.com/webmachinelearning/webmcp) lets a web page
register tools an AI agent can call, on `navigator.modelContext`. Browser
support for it is not universal, and a page's own JavaScript can either use
a native implementation, load a polyfill, or just assume support exists and
call into it blind. This extension is built to work across all three —
that's the entire purpose of the MAIN-world bridge described in
[docs/01-architecture.md](01-architecture.md#the-adopt-or-provide-shim) — but
the three cases behave differently and are worth knowing apart.

## Native

If the browser itself implements `navigator.modelContext` (currently an
origin trial / flagged feature in Chrome, not on by default), the page
registers tools directly against that real implementation. The bridge
**adopts** it: registrations are recorded for our own bookkeeping, then
forwarded to the native implementation unchanged, so the page behaves exactly
as it would with no extension installed. Tools discovered this way are
tagged `source: "native"`.

## Polyfilled

Many pages that want WebMCP today, ahead of native support, ship a polyfill
such as [`@mcp-b/global`](https://github.com/webmachinelearning/webmcp) that
assigns an implementation onto `navigator.modelContext` itself. Two
sub-cases:

- **Polyfill runs before the bridge's shim is read** — behaves like the
  native case: adopt, forward, tag `source: "polyfill"`.
- **Polyfill runs after** — this is the case that actually needs the bridge's
  accessor-property trick. Because the bridge redefined
  `navigator.modelContext` as an accessor at `document_start`, a later
  `navigator.modelContext = new SomePolyfill()` assignment from the page is
  intercepted by the shim's setter rather than silently replacing it. The
  setter adopts the newly-assigned object, migrates over anything registered
  in the meantime, and re-emits the current tool list. `demo/late.html`
  exists specifically to exercise this path — it deliberately waits two
  seconds (or a button click) before assigning a hand-written fake polyfill,
  and `npm run verify` asserts against it for real in a running browser.

## Unsupported (the common case today)

Most pages neither ship a polyfill nor run in a browser with native support.
If such a page's own script calls `navigator.modelContext.registerTool(...)`
expecting WebMCP to exist, it would normally throw a `TypeError` on
`undefined`. Because the bridge has already installed itself as
`navigator.modelContext` before any page script runs (`document_start`,
before the page's own scripts execute), the shim **provides** the
implementation instead — the page's call just works, tagged
`source: "shim"`, with no polyfill or native browser support required at
all. This is the biggest practical compatibility win: the extension can
discover tools from a page's own bespoke WebMCP-style code with nothing
extra installed on that page.

If a page publishes no WebMCP tools at all — the overwhelming majority of the
web — the side panel simply has no tools to attach to that tab's chat and the
model answers from its own knowledge, same as a plain chat session.

## Out of scope: iframes

The bridge only injects into the **top frame** (`all_frames: false` in
`manifest.config.ts`). A page that publishes tools from an embedded
iframe — a checkout widget, an embedded dashboard — is invisible to the
extension entirely; there is no fallback or partial support for this case.

Extending to `all_frames: true` isn't a flag flip: it requires deciding how
tool identity is namespaced across frames, what a tool-name collision between
two frames means, how a call gets routed back to the specific frame that
registered it, and whether it's worth the cost of injecting a content script
into every ad iframe on the web. This is tracked as deferred work — see
`boards/project-backlog/18-iframe-tool-discovery.md` and
`decisions/02-mainworld-webmcp-bridge.md` — not implemented in any partial
form.

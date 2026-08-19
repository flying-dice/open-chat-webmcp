---
status: Superseded
date: 2026-08-19
---
# Decision 02 — Discover WebMCP tools via a MAIN-world adopt-or-provide bridge

> **Superseded by [decisions/16](16-native-webmcp-client.md).** The API this
> decision targets (`navigator.modelContext`, `provideContext`,
> `unregisterTool`, `callTool`) no longer exists, and its central premise —
> that there is no read API for a page's registered tools — is false: the spec
> now has `getTools()` and `ontoolchange`. Kept for history.

## Context

WebMCP lets a page publish tools on `navigator.modelContext`. In the wild there
are three situations, and the extension must handle all of them:

1. **Native** — Chrome's built-in `navigator.modelContext` (origin trial /
   flagged). The page registers against the real implementation.
2. **Polyfilled** — the page ships `@mcp-b/global` or a similar shim, which
   *assigns* `navigator.modelContext` itself, possibly *after* our code runs.
3. **Absent** — the page calls `navigator.modelContext.registerTool(...)`
   expecting a browser that supports it, and gets a `TypeError` in ours.

An extension's content script runs in an ISOLATED world and cannot see page
JavaScript objects, so tool descriptors and their `execute` callbacks are
invisible from there. Enumerating tools out of the native implementation is also
not possible — there is no read API for "what has this page registered".

## Decision

Inject a **MAIN-world content script at `document_start`** (`world: "MAIN"` in
the manifest, Chrome 111+) that installs an *adopt-or-provide* shim on
`navigator.modelContext`:

- **Provide** — if nothing is there, the shim *is* the implementation. It stores
  registered tools and satisfies pages that assume WebMCP exists.
- **Adopt** — if a native or polyfilled implementation is already present, the
  shim wraps it: registrations are recorded, then forwarded to the underlying
  implementation so the page's normal behaviour is untouched.
- **Late adoption** — `navigator.modelContext` is redefined as an accessor whose
  setter captures any later assignment (the polyfill case), adopts it as the new
  underlying implementation, and re-emits the tool list.

Supported surface: `registerTool()` (returning a handle with `destroy()`),
`unregisterTool()`, `provideContext({ tools })` (replaces the declarative set),
and `callTool()`. Tool descriptors are serialised as
`{ name, description, inputSchema, annotations }`.

The bridge talks to the ISOLATED-world relay over `CustomEvent`s on `document`
(`webmcp-bridge:out` / `webmcp-bridge:in`) — DOM events cross worlds, page
globals do not. Payloads are JSON strings so no live object ever crosses.

## Consequences

- The extension sees tools from native, polyfilled, and unsupported pages alike,
  which is the single biggest compatibility win available.
- Because we run at `document_start`, we are in place before page scripts.
- The shim is observable by the page. A hostile page could detect or tamper with
  it; treat every tool descriptor and result as untrusted input.
- We only inject into the top frame in v1 — iframe tools are out of scope and
  tracked separately on the board.
- Registration and execution stay in the page's own world, so tools keep their
  closures, `this`, and same-origin privileges. Nothing is re-implemented.

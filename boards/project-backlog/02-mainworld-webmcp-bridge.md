---
column: review
labels: [frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T15:29:20.000Z
---
# MAIN-world WebMCP bridge (adopt-or-provide)

The heart of the extension: a `document_start` MAIN-world script that installs a
shim on `navigator.modelContext`, so we see tools whether the page uses Chrome's
native API, a polyfill like `@mcp-b/global`, or assumes support that isn't there.
Full rationale in decisions/02-mainworld-webmcp-bridge.md.

Adopt when an implementation already exists (record, then forward). Provide when
nothing is there. Re-define the property as an accessor so a polyfill assigning
`navigator.modelContext` *after* us is captured and adopted late.

Everything crosses to the ISOLATED world as JSON strings on `CustomEvent`s
(`webmcp-bridge:out` / `webmcp-bridge:in`) — no live objects, ever.

## Checklist

- [x] Shim implementing `registerTool` (handle with `destroy()`), `unregisterTool`, `provideContext({tools})`, `callTool`
- [x] Adopt path: forward every call to the underlying native/polyfill impl
- [x] Provide path: be the implementation when none exists
- [x] Accessor setter for late polyfill assignment, re-emit tool list on adopt
- [x] Serialise descriptors as `{name, description, inputSchema, annotations}`
- [x] Emit `tools` on every registration change; emit `ready` on install
- [x] Execute a call and return `{id, ok, result | error}`, with a timeout
- [x] Survive a page that throws inside its own `execute`

## Comments

- **claude** (2026-08-19T15:29:20.000Z): Implemented the adopt-or-provide shim in src/inject/bridge.ts. `install()` (src/inject/bridge.ts:517-537) checks the current `navigator.modelContext` value, adopts it if it looks like a real implementation (`isImplementation`, src/inject/bridge.ts:110-112), then redefines the property as an accessor via `tryDefineAccessor` (src/inject/bridge.ts:358-375) whose getter always returns our `shim` singleton (src/inject/bridge.ts:406 onward) and whose setter calls `adopt()` (src/inject/bridge.ts:298-356) to capture a late polyfill assignment, migrate any provide-mode ("shim"-sourced) registrations into it, and re-emit. `adopt()` snapshots bound references to the original methods (src/inject/bridge.ts:307-326) rather than holding the live object, specifically so the non-configurable-property fallback (`patchInPlace`, src/inject/bridge.ts:382-398, used only when `Object.defineProperty` itself throws) can safely overwrite the existing object's own methods without recursing into itself. Source is tracked per tool ('native' via a `[native code]` toString heuristic in `looksNative`, src/inject/bridge.ts:115-122, vs 'polyfill' vs 'shim') and carried in every `SerializedTool`. Calls from the relay (`bridge:call-request`) run through `executeTool`/`callWithTimeout` (src/inject/bridge.ts:280-290, 161-185) with a 20s timeout, and the result is passed through a JSON round-trip (`safeJson`, src/inject/bridge.ts:134-159) before being emitted, so a throwing, hanging, or non-serialisable `execute` always produces a clean `{ok:false, error}` on `bridge:call-result` instead of breaking the bridge. Also added `bridge:get-tools` (relay -> bridge "resend the list") to src/lib/protocol.ts as an additive `BridgeInEvent` member, needed by the relay's startup/bfcache-restore/refresh handling in card 03.

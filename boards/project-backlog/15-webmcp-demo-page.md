---
column: review
labels: [infra]
priority: med
updatedAt: 2026-08-19T15:34:29.000Z
---
# Local WebMCP demo page for development

A static page registering a handful of tools so the extension can be developed
and tested without depending on a third-party WebMCP site.

Needs to exercise both discovery paths from decisions/02-mainworld-webmcp-bridge.md:
tools registered against our provided shim, and tools registered against a
polyfill loaded *after* us, to prove late adoption works.

## Checklist

- [x] Read-only tool (`readOnlyHint: true`) reading page state
- [x] Mutating tool that visibly changes the DOM
- [x] Destructive-hint tool, to exercise the approval path
- [x] Tool with a rich input schema (enums, nested object, required fields)
- [x] A tool that throws, and one that hangs, for timeout handling
- [x] Variant page that assigns `navigator.modelContext` after load
- [x] Dynamic register/unregister to test live tool-list updates
- [x] Served by `npm run demo`

## Comments

- **claude** (2026-08-19T15:34:29.000Z): Implemented under new top-level `demo/`, plus one `demo` script in package.json. Two variants share tool/UI code: `demo/index.html` + `demo/src/main.ts` feature-detect `navigator.modelContext` and register immediately (the shim/native path); `demo/late.html` + `demo/src/late-main.ts` deliberately touch nothing on load, then dynamically `import()` a hand-written fake polyfill (`demo/src/fake-polyfill.ts`, imitating `@mcp-b/global`'s shape — no npm dependency added) and assign `navigator.modelContext = new FakeModelContextPolyfill()` 2s after load (or on button click), proving the bridge's accessor-setter late-adoption path from decisions/02-mainworld-webmcp-bridge.md:35-37. Six shared tools live in `demo/src/tools.ts`: `read-page-state` (readOnlyHint, decisions/05-tool-approval-policy.md:20-21), `add-note` (mutating, no annotations, visibly appends to the DOM), `clear-notes` (destructiveHint), `create-task` (rich schema: enum priority, nested required `assignee` object, optional `tags` array), `always-throws`, and `hangs-forever` (never-resolving promise, for timeout testing). A seventh, `dynamic-echo` (`demo/src/tools.ts:158-175`), is registered/unregistered at runtime via page buttons wired in `demo/src/main.ts:83-96` and `demo/src/late-main.ts:75-86`, to test live tool-list updates. `demo/src/ui.ts` renders the live "registered tools" table and wraps every tool's `execute` (`withLogging`, `demo/src/ui.ts:100-131`) so every invocation — args, result or thrown error, and a `pending…` state for the hanging tool — is logged on the page itself for comparison against the extension's inspector. `npm run demo` runs `vite --config demo/vite.config.ts` (root pointed at `demo/`, port 5175, no crx plugin) serving over http, never file://. Verified with Playwright against the built dev server: late-adoption assigns and registers correctly, `add-note`/`create-task`/`clear-notes`/`always-throws` round-trip via `navigator.modelContext.callTool`, dynamic register/unregister updates the live list, `hangs-forever` never settles, and `index.html` degrades gracefully to an error status after a 5s timeout when no extension is present. `npm run build` and `npm run check` both stay green (demo/ is outside both tsconfig includes, confirmed via a standalone `demo/tsconfig.json` + `npx tsc -p demo/tsconfig.json`, 0 errors). Did not touch `src/lib/protocol.ts` or any other src/ directory.

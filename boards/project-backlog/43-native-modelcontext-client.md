---
column: review
labels: [backend, bug]
priority: high
agent: sonnet
updatedAt: 2026-08-19T21:28:02.000Z
---
# Replace the MAIN-world shim with a native `document.modelContext` client

The core of the migration. Delete the 555-line adopt-or-provide bridge and read
the native API directly from the ISOLATED-world relay.

Depends on [42](42-adopt-official-webmcp-packages.md).
See [decisions/16](../../decisions/16-native-webmcp-client.md) — read it first;
it records the exact measured Chrome behaviour, which differs from the
published spec IDL.

## Scope

**Delete**
- `src/inject/bridge.ts` entirely.
- The `world: "MAIN"` content-script entry in `manifest.config.ts:61-66`.
- The `standaloneFiles: ["src/inject/bridge.ts"]` carve-out in
  `vite.config.ts:10-19`.
- The bridge half of `src/lib/protocol.ts`: `BRIDGE_OUT_EVENT`/`BRIDGE_IN_EVENT`
  (`:50-51`), `Bridge*Event` types (`:53-97`), `isBridgeOutEvent`/
  `isBridgeInEvent` (`:190-204`).
- `ToolSource` (`:20`) and `SerializedTool.source` (`:38`) — the
  native/polyfill/shim distinction is meaningless now. Update
  `src/sidepanel/components/ToolListItem.svelte:29-39` accordingly.
- The world-isolation assertion in `src/content/relay.ts:284-290`.

**Rewrite `src/content/relay.ts`** to talk to `document.modelContext` directly:

- Discovery: `await document.modelContext.getTools()`.
- Live updates: `document.modelContext.ontoolchange = ...` (confirmed to fire in
  the ISOLATED world on both register and abort-unregister). Debounce ~100ms.
- Invocation: `await document.modelContext.executeTool(tool, JSON.stringify(args))`.

**Behaviours that are measured, not guessed** — get these right or nothing works:

- `RegisteredTool.inputSchema` is a **JSON string**. `JSON.parse` it (defensively)
  before it reaches `SerializedTool.inputSchema`.
- `executeTool`'s input **must be a JSON string**. Passing an object fails with
  `UnknownError: Failed to parse input arguments`.
- `executeTool` returns a **nullable JSON string** — parse it, and handle `null`.
- `executeTool` takes the **`RegisteredTool` object**, not a name. The worker
  calls tools *by name*, so the relay must keep the live objects from the last
  `getTools()` and resolve name → object, re-fetching on a miss before erroring.
- `RegisteredTool.window` is a live `Window` and is **not** structured-cloneable.
  Strip it (and anything else non-JSON) when building `SerializedTool`.
- `document.modelContext` may be **absent** (feature off, no OT token). Detect
  once and report a distinct, actionable state — not an empty tool list. It must
  be distinguishable from "page has no tools" in the panel.

**Timeout ladder.** The innermost rung is gone. The relay now owns execution:
relay 20s → worker 30s (`src/background/sw.ts:228`). Update the ladder comments
in `relay.ts:26-40` and `sw.ts:223-227`; they currently describe three layers.
`boards/project-backlog/30-panel-timeout-outside-ladder.md` is still open and
still applies to the panel's own budget — do not silently fold it in here.

**Also fix while in `protocol.ts`:** `sw.ts` keeps a local duplicate of
`RuntimeRefreshToolsRequest` (flagged at `protocol.ts:141-147`) — import the
shared type instead.

## Checklist

- [x] Rewrite `src/content/relay.ts` against the native API
- [x] Strip the bridge half of `src/lib/protocol.ts`; drop `ToolSource`
- [x] Delete `src/inject/bridge.ts`; update manifest + vite config
- [x] Handle the "WebMCP unavailable" state distinctly from "no tools"
- [x] Update `ToolListItem.svelte` for the removed `source` field
- [x] Fix the duplicated `RuntimeRefreshToolsRequest` in `sw.ts`
- [x] Update the timeout-ladder comments to the two remaining layers
- [x] `npm run check` and `npm run build` pass

## Comments

- **sonnet** (2026-08-19T21:05:00.000Z): Claimed the card. Read decisions/16, decisions/17, and card 42's findings (`@mcp-b/webmcp-types@4`'s `ModelContextToolInfo`/`ModelContextCore` already model Chrome's shipped shapes — string `inputSchema`, string-in/nullable-string-out `executeTool`). One gap card 42 didn't flag: `ModelContextToolInfo` has NO `annotations` field in the package types at all, even though decisions/16/17 measured Chrome actually returning `{ readOnlyHint, untrustedContentHint }` from `getTools()`. Handled by a local `NativeToolInfo extends ModelContextToolInfo { annotations?: ToolAnnotations }` in `src/content/relay.ts:73-85` rather than casting to `any` at each call site.
- **sonnet** (2026-08-19T21:15:00.000Z): Deleted `src/inject/bridge.ts` (and the now-empty `src/inject/` dir). Removed the MAIN-world content-script entry from `manifest.config.ts` (was `:60-66`) and the `standaloneFiles` carve-out from `vite.config.ts` (was `:10-19`), both with comments explaining why the constraint no longer applies. Rewrote `src/lib/protocol.ts`: dropped `ToolSource`, `SerializedTool.source`, `BRIDGE_OUT_EVENT`/`BRIDGE_IN_EVENT`, every `Bridge*Event` type, and `isBridgeOutEvent`/`isBridgeInEvent`; `Msg` is now just `RuntimeMessage`. Added `available: boolean` to `RuntimeToolsUpdatedMessage` and `RuntimeGetToolsResponse` (`protocol.ts:66-78`, `:88-95`) to carry the "WebMCP unavailable" signal end-to-end — see next entry.
- **sonnet** (2026-08-19T21:18:00.000Z): Fully rewrote `src/content/relay.ts` against `document.modelContext`. Availability is read once at module load (`relay.ts:118-127`, `document.modelContext !== undefined`) since an origin-trial token is evaluated at parse time and doesn't change mid-page-lifetime. `refreshTools()` (`relay.ts:224-232`, later updated — see below) calls `getTools()`, rebuilds a `name -> NativeToolInfo` cache and the serialized list, and pushes a `runtime:tools-updated` push to the worker. `resolveTool()` (`relay.ts:234-251`) resolves the worker's by-name `runtime:call-tool` request to the live object, re-fetching once on a cache miss before reporting "Unknown tool" — this replaces the old id-matched CustomEvent round trip entirely, since `executeTool` is now a directly-awaitable native call with no separate page-world script to wait on. `ontoolchange` is wired at `relay.ts:382-384` through a 100ms-debounced `scheduleToolsRefresh` (`TOOLCHANGE_DEBOUNCE_MS`, `relay.ts:58`). Deleted the `window.__webmcpBridgeInstalled` world-isolation assertion entirely (no bridge left to leak). `SerializedTool` construction never reads `tool.window` (`relay.ts:200-207`'s `serialize()`), so `RegisteredTool.window` is stripped by simple omission rather than an explicit delete.
- **sonnet** (2026-08-19T21:20:00.000Z): Updated `src/background/sw.ts`: `RegistryEntry` gained `available: boolean` (`sw.ts:52-62`), threaded through `handleGetTools`'s cached/pulled/unreachable paths (`sw.ts:273-306` — the unreachable-relay fallback now reports `available: false` rather than a bare empty list, since we genuinely can't know), the `runtime:tools-updated` inbound handler (`sw.ts:346-348`), and `isToolsUpdatedMessage`'s shape guard (`sw.ts:188-197`). Rewrote the timeout-ladder comments in `relay.ts:37-50` and `sw.ts:209-231` from 3 layers (bridge/relay/worker) to 2 (relay/worker); also fixed the same stale 3/4-layer comment in `src/sidepanel/services/agentLoop.ts:106-119` since it's the same ladder this card changes and was left referencing a deleted file. Checked `sw.ts`'s `RuntimeRefreshToolsRequest` usage (`sw.ts:26,232`) — it already imports the shared `protocol.ts` type rather than a local duplicate (must have been fixed incidentally by an earlier card); only `protocol.ts`'s own doc comment still claimed otherwise, so corrected that comment rather than sw.ts itself.
- **sonnet** (2026-08-19T21:22:00.000Z): Updated `src/sidepanel/components/ToolListItem.svelte` — removed `sourceLabel`/`sourceTitle` and the source badge, plus the now-unused `.badge-source` CSS rule; kept the `readOnlyHint`/`destructiveHint` badges untouched (card 44's territory per the parent instruction). Threaded `available`/`webmcpAvailable` the rest of the way to the UI so "WebMCP unavailable" is visibly distinct from "no tools published," per the card's explicit requirement: `PageInfo.webmcpAvailable` (`src/sidepanel/stores/panel.svelte.ts:178-193`), `setToolCount`'s new third param (`panel.svelte.ts:615-619`), `getToolsAndAvailabilityForTab`/`getToolsForTab` in `src/sidepanel/services/activeTab.ts:104-127`, `refreshActiveTab` (`activeTab.ts:142-160`) and the live-update listener (`activeTab.ts:203-206`), through `Inspector.svelte` (new `webmcpAvailable` prop) and `App.svelte:190-198` (`panel.pageInfo?.webmcpAvailable ?? true`), into `ToolsPanel.svelte`'s empty state, which now branches on `!webmcpAvailable` first with its own explanatory copy about `--enable-features=WebMCP`/the flag/origin-trial tokens, distinct from the existing "page has no tools" copy.
- **sonnet** (2026-08-19T21:25:00.000Z): `npm run check` — 155 files, 0 errors, 0 warnings (was 156 before this card since `src/inject/bridge.ts` is gone). `npm run build` — succeeds; verified `dist/manifest.json`'s `content_scripts` array now has exactly one entry (`world: "ISOLATED"`, `js: ["assets/relay.ts-loader-*.js"]`) — no MAIN-world script ships any more. Did not touch `demo/`, `verify/`, `docs/`, README, or `minimum_chrome_version` (cards 45/46/47's territory) — confirmed via `git status` that only files this card is responsible for changed. Did not touch `ToolAnnotations`/`destructiveHint` in `protocol.ts` or the destructive badges in `ApprovalCard.svelte`/`ToolCallCard.svelte` (card 44's territory). `npm run verify` was smoke-tested (launches Chromium, resolves an extension id) but not run to completion or fixed — expected per the parent instruction, since it still assumes the deleted bridge/CustomEvent transport (card 46's territory).
- **sonnet** (2026-08-19T21:35:00.000Z): Overseer review (reading the official inspector's actual source, beaufortfrancois/model-context-tool-inspector v1.9.14) surfaced two refinements, applied before moving to review:
  1. **`executeTool`'s argument form is mid-migration in Chrome itself**, not just spec-vs-shipped. The inspector's `content.js:41-49` tries the OBJECT form first and falls back to the JSON-STRING form only on an error whose message starts with `"Failed to parse input"`, with a TODO noting Chrome Stable is expected to drop string-form support. decisions/16's measurement (string form required on 151/152) is still accurate today, but hardcoding it would silently break on a future Chrome. Added `callExecuteTool()` (`src/content/relay.ts:257-287`) mirroring the inspector's try/catch shape exactly — object form via a narrow cast (the package types only declare the string form), falling back to `JSON.stringify` only on that specific message, rethrowing anything else. `handleCallTool` (`relay.ts:289-336`) now calls this instead of eagerly `JSON.stringify`-ing up front.
  2. **Scope the name → tool lookup by frame.** `getTools()` can return tools registered by other frames on the same page (each entry carries its own `window`); the inspector matches `t.window === window` (`content.js:38`) so a same-named tool in a subframe can't shadow the top frame's. Applied the same filter in `refreshTools()` (`relay.ts:224-236`, `raw.filter((t) => t.window === window)`) before building both the by-name cache and the serialized list shown in the panel — consistent with this relay only running in the top frame at all (`all_frames: false`).
  Re-ran `npm run check` (155 files, 0 errors) and `npm run build` (succeeds) after both changes — clean. Moving to review.
- **claude** (2026-08-19T22:35:00.000Z): Overseer end-to-end verification — the check this entire batch of work exists to satisfy. Built `dist/` and loaded it into Chrome for Testing 152.0.7977.54 (`--enable-features=WebMCP`) **alongside the real official inspector** (`beaufortfrancois/model-context-tool-inspector` v1.9.14), both extensions live in the same browser on the same page (`npm run demo`, http://localhost:5175). Queried each through its own path: ours via `chrome.runtime.sendMessage({type:'runtime:get-tools', tabId})` from the side panel, theirs via `{action:'LIST_TOOLS'}` to their content script. Both returned the **identical** 7-tool set — `add-note, always-throws, clear-notes, create-task, hangs-forever, read-notes-content, read-page-state`. Ours additionally reported `available: true`, delivered `inputSchema` as a parsed **object** (Chrome hands it over as a JSON string, so the relay's parse step is working), and carried `annotations: {readOnlyHint: true, untrustedContentHint: true}` on `read-notes-content`. Also confirmed `dist/manifest.json` ships exactly one content script (`world: "ISOLATED"`, `all_frames: false`) — no MAIN-world code left. The interoperability failure that opened this migration is fixed on both the page side and the extension side.

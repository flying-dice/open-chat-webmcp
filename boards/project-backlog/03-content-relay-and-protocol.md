---
column: review
labels: [frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T15:29:20.000Z
---
# ISOLATED-world relay and the typed message protocol

The relay is the only thing that can see both the page bridge and
`chrome.runtime`. It forwards tool lists up to the worker and tool calls down to
the page, matching responses by id.

`src/lib/protocol.ts` defines every message exchanged between bridge, relay,
worker, and panel — the main reason the project takes a build step at all
(decisions/03-vite-svelte-build.md).

## Checklist

- [x] `protocol.ts`: discriminated unions for tool lists, call requests, results, errors
- [x] Relay listens for `webmcp-bridge:out`, forwards tool lists to the worker
- [x] Relay handles `webmcp/call`, dispatches `webmcp-bridge:in`, resolves by id
- [x] Pending-call map with timeout and cleanup on page unload
- [x] Request the current tool list on relay startup (handles panel-opened-late)
- [x] Re-announce tools on `pageshow` / bfcache restore

## Comments

- **claude** (2026-08-19T15:29:20.000Z): Implemented src/content/relay.ts against src/lib/protocol.ts. `chrome.runtime.onMessage` listener (src/content/relay.ts:179-197) handles `runtime:call-tool` by generating an id, storing a `{sendResponse, timer}` pair in `pendingCalls` and dispatching `bridge:call-request` into the page (src/content/relay.ts:46-53); `bridge:call-result` events resolve the matching entry by id (`resolvePendingCall`, src/content/relay.ts:154-165). `pagehide` (persisted:false) fails every outstanding pending call so the worker never hangs on a real navigation (src/content/relay.ts:257-261); `pageshow` (persisted:true, bfcache restore) and relay startup itself (src/content/relay.ts:254) both re-request the tool list via a new `bridge:get-tools` event, covering the panel-opened-late and MAIN/ISOLATED-world startup-ordering races. Tool announcements (`bridge:tools`) are cached in `latestTools`/`latestToolsKnown` and forwarded up as `runtime:tools-updated` (src/content/relay.ts:212-249, 61-72).
- **claude** (2026-08-19T15:29:20.000Z): Mid-task the coordinator relayed a cross-agent need from the service-worker card: on worker restart it loses its per-tab registry and sends `runtime:refresh-tools` to recover. Promoted that into src/lib/protocol.ts as `RuntimeRefreshToolsRequest` (protocol.ts:145-160, added to the `RuntimeRequest` union at :164 and to `isRuntimeMessage` at :206-214) — additive only, alongside the `bridge:get-tools` / `BridgeGetToolsRequestEvent` addition to `BridgeInEvent` (protocol.ts:77-97, guard updated at :199-203) that the relay itself needed. Handled in `handleRefreshToolsRequest` (src/content/relay.ts:122-142): answers immediately from cache if we've ever heard from the bridge, else waits up to 2.5s (under the worker's ~3s budget) via `pendingRefreshes`, flushed by the next `bridge:tools` event (`flushPendingRefreshes`, src/content/relay.ts:111-118). **Note for the service-worker agent**: src/background/sw.ts currently defines this type locally as `WorkerRefreshToolsRequest` — it should switch to importing `RuntimeRefreshToolsRequest` from protocol.ts and drop its local copy.

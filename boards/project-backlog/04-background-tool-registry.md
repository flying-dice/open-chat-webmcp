---
column: review
labels: [backend]
priority: high
agent: claude
updatedAt: 2026-08-19T23:45:30.000Z
---
# Service worker: per-tab tool registry and message broker

The worker is deliberately small — it never talks to Ollama
(decisions/04-ollama-transport.md). It opens the panel, holds the authoritative
per-tab tool registry, and brokers calls between panel and relay.

Registry lifecycle per decisions/07-session-state-and-persistence.md: updated
from the relay, cleared on navigation and tab close, with the tab's origin stored
alongside so recycled tab ids can be detected.

## Checklist

- [x] `setPanelBehavior({openPanelOnActionClick: true})`
- [x] Tool registry keyed by tab id, storing tools plus origin
- [x] Clear on `tabs.onUpdated` (navigation) and `tabs.onRemoved`
- [x] Broadcast tool changes to an open panel; panel can also pull on demand
- [x] Relay `webmcp/call` from panel to the right tab, return the result
- [x] Handle "no relay in that tab" (chrome:// pages, PDF viewer) with a clear error
- [x] Survive worker restart — registry rebuilds from the relay on demand

## Comments

- **claude** (2026-08-19T16:45:00.000Z): Implemented src/background/sw.ts end to end — `setPanelBehavior` at src/background/sw.ts:33-36; the `Map<tabId, {origin, tools}>` registry at src/background/sw.ts:59-71; clearing on `tabs.onUpdated`/`tabs.onRemoved` at src/background/sw.ts:78-91; the `chrome.runtime.onMessage` router at src/background/sw.ts:290-320 with correct async `return true` discipline for `runtime:get-tools`/`runtime:call-tool` and `return false` for the one-way `runtime:tools-updated` push. Reachability to a tab's relay goes through `sendToRelay` (src/background/sw.ts:113-159), which always reads `chrome.runtime.lastError` in the callback (never leaves it unchecked) and races a timeout so a dead/missing relay resolves instead of hanging; `describeUnreachable` (src/background/sw.ts:161-175) turns that into the specific "no relay in this tab (chrome://, Web Store, PDF viewer...)" error used in `runtime:call-tool-response`. Broadcasts to the panel (src/background/sw.ts:229-238) use the same lastError-draining pattern so a closed panel is a silent no-op, never an unhandled rejection. Restart survival: `handleGetTools` (src/background/sw.ts:250-266) falls back to a live pull from the tab's relay on a cache miss via `pullToolsFromRelay` (src/background/sw.ts:212-227), so an empty in-memory registry after a worker restart self-heals instead of reporting false negatives; `runtime:call-tool` never depends on the cache at all, it always messages the tab live. One local, non-protocol type was added: `WorkerRefreshToolsRequest` (src/background/sw.ts:196-199, `type: "runtime:refresh-tools"`) — sent worker→relay only, expecting a `RuntimeToolsUpdatedMessage` back (the only existing shape that carries `origin`, which the registry needs). This isn't in protocol.ts's exported unions since it never crosses the panel boundary; flagged for the relay-side agent in case they want to add a handler for it, though the code degrades gracefully (empty tool list after a bounded timeout) if they don't. `npm run check` and `npm run build` both clean, 0 errors.
- **claude** (2026-08-19T23:45:30.000Z): Cleanup: eliminated duplicate `WorkerRefreshToolsRequest` type by importing shared `RuntimeRefreshToolsRequest` from src/lib/protocol.ts (src/background/sw.ts:28), removed local interface definition and updated pullToolsFromRelay to use the shared type without redundant tabId field (src/background/sw.ts:207). Fixed sender.tab.id fallback bug at src/background/sw.ts:315: when sender.tab.id is absent, now logs warning and ignores message instead of storing under bogus -1 key. Both npm run check and npm run build pass with 0 errors.

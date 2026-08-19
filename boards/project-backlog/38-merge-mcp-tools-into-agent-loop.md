---
column: review
labels: [backend]
priority: high
agent: sonnet
live: false
updatedAt: 2026-08-19T00:00:00.000Z
---
# Merge namespaced MCP tools into the agent loop

DEPENDS ON card 37 (done, in review). The second half of
decisions/14-backend-mcp-servers.md. The mechanics are settled in
**decisions/19-merging-server-tools-with-page-tools.md** — read it first; it
picks the namespace separator, resolves the two annotation vocabularies,
requires remote results to be fenced, and rules out blocking the page on server
discovery. This card implements it. The
model sees ONE tool list combining the current page's WebMCP tools and the tools
of every enabled MCP server, namespaced by server so nothing can collide.

> **Superseded mid-card by decisions/20-approval-policy-is-per-tool-source.md**:
> the paragraph below ("approval policy applies unchanged to both kinds") is
> the ORIGINAL brief and is now wrong — decision 20 replaces it. Page tools
> keep decisions/05/17's rule unchanged; server tools get a separate,
> stricter, independent `McpApprovalPolicy` (default "always-confirm",
> regardless of `readOnlyHint"). See the journal below and decision 20 itself
> for the full rationale. Everything else this card was asked for
> (namespacing, the two annotation vocabularies, fencing, non-blocking
> discovery, one executor, origin on every surface) is unchanged.

The approval policy applies unchanged to both kinds — `readOnlyHint` runs
automatically, everything else asks. Note decisions/05 is now superseded by
decisions/17-spec-annotations-and-untrusted-content.md, which kept that rule but
removed `destructiveHint` from WebMCP annotations and added untrusted-content
fencing. MCP's own `destructiveHint` is a different, still-valid vocabulary —
see decisions/19 §2, and do not trim `McpToolAnnotations` to match WebMCP's.

What needs real care is that "read-only" means something very different for a page
you are looking at and a remote service you are not. The approval card and the
inspector must make WHERE a call will execute unmistakable, so a user is never
approving a remote action believing it is a local one. That is a UI honesty
requirement, not a nicety.

Dispatch is now conditional: page tools route through the worker to the content
relay, server tools go straight out over HTTP from the panel. The agent loop
should not grow two parallel code paths — resolve a tool to its executor once, at
the point the merged list is built.

## Checklist

- [x] Namespacing per decisions/19 §1 (`server__tool`, page tools bare, collisions to the page)
- [x] Merged list built once, each tool carrying its executor
- [x] Page tools still route via the worker; server tools call the MCP client
- [x] Approval, tools list and call log show where a tool executes, unmistakably
- [x] Remote results fenced as untrusted (decisions/19 §3)
- [x] Server discovery cached off the turn's critical path (decisions/19 §4)
- [x] Missing host permission reported as that specific reason, not a generic failure
- [x] Call log records the tool's origin alongside args and result
- [x] A dead server degrades to "its tools are unavailable", never a broken loop
- [x] Header values never reach the call log (decisions/15)
- [x] Page and server tool calls judged by two independent, separately-readable approval policies (decisions/20), not one shared function
- [x] Server tool session skip-list keyed `${serverId}::${toolName}`, never by page origin (decisions/20)
- [x] Host permission remains a precondition (unavailable tool), never routed through the approval path (decisions/20)
- [x] Options page exposes the two policies as two controls with distinct copy (decisions/20)

## Gates

- [x] check — `npm run check` (svelte-check + tsc) 166 files, 0 errors (sonnet, 2026-08-19T23:15:00.000Z)
- [x] build — `npm run build` (vite build) green, no warnings (sonnet, 2026-08-19T23:15:00.000Z)
- [x] verify — `npm run verify` 9/9 required checks passed, screenshots best-effort PASS (sonnet, 2026-08-19T23:05:00.000Z)

## Comments

- **sonnet** (2026-08-19T22:20:00.000Z): Claimed the card. Read decisions/19, 14, 17 and card 37's foundation (src/lib/mcp/types.ts:1-214, client.ts, registry.ts, permissions.ts) plus the consumer side (agentLoop.ts, activeTab.ts, panel.svelte.ts, the approval/tool UI components). Starting on the namespacing/merge module.
- **sonnet** (2026-08-19T22:45:00.000Z): Added `src/lib/mcp/merge.ts` — namespacing (`slugifyServerName`, `assignServerSlugs`, `namespacedToolName`, both truncation and page-wins-collision handled), the `MergedTool`/`ToolDescriptor` shapes (normalised `ToolAnnotations` for approval + original `McpToolAnnotations` for display, decisions/19 §2), `buildServerMergedTools` (pure, network-free) and `combineWithPageTools` (per-turn, cheap). Added `src/sidepanel/services/mcpTools.ts` for discovery caching (`ensureMcpDiscoveryFresh` fire-and-forget, coalesced, never awaited on a turn) and the `ServerToolExecutor` (`executeServerTool`) that checks `hasHostPermission` before AND at call time, translating a missing grant into a specific reason. Added `McpError`'s new `"permission"` kind to src/lib/mcp/types.ts:54-90 for this.
- **sonnet** (2026-08-19T23:00:00.000Z): Wired the merge into src/sidepanel/services/agentLoop.ts:236-263 (`runAgentTurn` builds the merged list once), 269-301 (`buildSystemPrompt` states origin per line), 437-506 (`executeToolCall` resolves name -> `MergedTool` -> `tool.call`, no per-kind branch), and 528-594 (`raceToolCall`/`callPageTool` — one generic timeout/abort race for both kinds). Threaded `origin`/`mcpAnnotations` through panel.svelte.ts's `addToolCall`/`PanelMessage` and session.ts's `ToolCallLogEntry`. Updated ApprovalCard.svelte, ToolListItem.svelte (+ split ToolsPanel.svelte into "This page"/"MCP servers" sections), ToolCallCard.svelte, and CallLogEntry.svelte to show origin on every surface (decisions/19 §6). `npm run check`/`build` green; `npm run verify` 9/9 (verify never touches the sidepanel Svelte code, only sw.ts/relay.ts directly, so this was low-risk).
- **sonnet** (2026-08-19T23:10:00.000Z): Mid-card direction change from the repo owner: decisions/20-approval-policy-is-per-tool-source.md supersedes the "one policy for both kinds" clause of decisions/14 and replaces decisions/19 §2's approval sentence. Reworked approval into two independent, separately-readable units per decision 20 — no shared "handles both" function:
  - src/lib/settings.ts:73-127 — new `McpApprovalPolicy` (`always-confirm` default | `trust-read-only` | `auto-run-all`) with its own storage key (`settings:mcpApprovalPolicy`), getter/setter/change-subscription, entirely separate from `ApprovalPolicy`'s existing code.
  - src/sidepanel/services/agentLoop.ts:456-506 — `shouldAutoRunPageTool` (decision 17, unchanged) and `shouldAutoRunServerTool` (decision 20, new) as two standalone async functions; `executeToolCall` is now a thin 3-line dispatcher on `tool?.origin.kind` that picks one, never branches internally.
  - src/sidepanel/stores/approvals.svelte.ts — rewrote entirely: `pageSkipList`/`serverSkipList` are two separate `Set`s (`${pageOrigin}::${toolName}` vs `${serverId}::${toolName}`), `requestPageApproval`/`requestServerApproval` are two separate functions each reading its own policy, `requestApproval` is a thin dispatcher.
  - src/options/components/SettingsSection.svelte — added a second "MCP server tool approval" section with its own radio group, own copy, own state/subscription, right after the existing page "Tool approval" section.
  - src/sidepanel/components/ApprovalCard.svelte — origin line now states which policy applies and the "don't ask again" label reads "on this server" vs "on this page" depending on `tool.origin.kind`.
  - Fixed stale copy in src/options/components/McpServersSection.svelte:146-151 that had said "the same approval policy applies" — written before decision 20 existed.
  - Host permission stayed exactly where it already was (a precondition inside mcpTools.ts's discovery/call path, never touching the approval seam) — decision 20 §"Host permission is a precondition" was already satisfied by the original design, no change needed there.
  - Re-ran `npm run check`/`build` (both green) and `npm run verify` (9/9) after the rework. Manually smoke-tested the Tools view (two sections render correctly, screenshot saved) and the options page's two new radio groups (screenshot saved) via a throwaway Playwright script against dist-verify/, plus a `node --experimental-strip-types` run of merge.ts's pure functions (slug dedup, 64-char truncation preserving the tool name, page-wins-collision) to check the namespacing logic directly rather than by assertion.
  - Updated docs/01-architecture.md's "A tool call, end to end" section and README.md's feature bullets to describe the merge + dual policy — both previously described only the page-tool-only world.

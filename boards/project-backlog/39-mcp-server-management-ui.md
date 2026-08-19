---
column: review
labels: [frontend]
priority: med
agent: claude
live: false
updatedAt: 2026-08-19T21:05:00.000Z
---
# MCP server management UI

DEPENDS ON card 37. Options-page section to add, edit, remove, enable/disable and
test MCP servers, per decisions/14-backend-mcp-servers.md.

Mount it as a sibling section alongside the providers and settings sections — card
22 established the layout shell and card 13 the second section, so this is the
third. Reuse that shell rather than inventing a third visual pattern.

"Test connection" should do a real handshake and `tools/list`, then show WHAT it
found — the tool names — not just a green tick. Discovering that a server connects
but exposes nothing useful is the common failure, and a tick hides it.

## Checklist

- [x] Server list: add / edit / remove / enable / disable / reorder
- [x] URL, display name, auth, and custom headers (decisions/15) with masked values
- [x] Host permission request from a user gesture, with grant state shown
- [x] Test connection performs a real handshake and lists discovered tools
- [x] Distinct failure messages: unreachable, auth rejected, not an MCP endpoint
- [x] Empty state explaining what an MCP server is and that remote-only is supported
- [x] Note that credentials and header values are stored unencrypted locally

## Gates

- [x] check — npm run check: 0 errors, 150 files (claude, 2026-08-19T21:00:00.000Z)
- [x] build — npm run build: clean production build (claude, 2026-08-19T21:00:30.000Z)
- [x] verify — npm run verify: 9/9 required checks passed (claude, 2026-08-19T21:01:00.000Z)

## Comments

- **claude** (2026-08-19T20:50:00.000Z): Read the full spec (card 39, decisions/14, decisions/15), src/lib/mcp/{registry,client,types,permissions}.ts (card 37, just landed), and the established ProvidersSection/ProviderForm/ProviderRow pattern to reuse rather than reinvent.
- **claude** (2026-08-19T20:55:00.000Z): Consolidated the duplicated host-permission helper card 37 flagged: new canonical implementation at src/lib/permissions.ts:1, with src/options/lib/permissions.ts:1 and src/lib/mcp/permissions.ts:1 reduced to thin re-exports so neither side's existing imports (ProviderForm.svelte, ProvidersSection.svelte) had to change. Confirmed via grep that nothing yet imports the MCP copy's own names, so this was a safe, non-breaking fold.
- **claude** (2026-08-19T20:58:00.000Z): Built the third options section on top of src/lib/mcp/registry.ts's CRUD, mirroring ProvidersSection/ProviderForm/ProviderRow closely: src/options/components/McpServersSection.svelte:1 (list, add/remove/reorder, permission-badge lifecycle), McpServerForm.svelte:1 (URL, name, transport preference, bearer token, custom-headers editor reusing `validateServerHeaders` from src/lib/mcp/registry.ts:105 for reserved-header validation), McpServerRow.svelte:1 (adds an Enable/Disable toggle providers don't have, via `updateServer(id, {enabled})`). Wired into src/options/App.svelte:9,20 as the third section. Reused options.css's existing generic classes as-is (`.provider-row`, `.form`, `.header-row`, `.badge`, etc.) and only added two new rules: `.provider-row--disabled` and `.mcp-tool-list` in src/options/options.css:159-181.
- **claude** (2026-08-19T21:00:00.000Z): Test-connection is the point of the card, so it reuses `discoverAllServerTools` (src/lib/mcp/client.ts) called with one server — that already bundles a real `initialize` handshake AND `tools/list` into one round trip and one result shape (connection + tools), rather than two separate calls. Wrapped in src/options/lib/mcpTestConnection.ts:1 (`testMcpServerConnection`, mapping every `McpError` kind 1:1 into a distinct `McpTestOutcome`) and src/options/lib/mcpTestResultDisplay.ts:1 (per-kind wording — "not-mcp-endpoint" explicitly calls out "if you pasted the URL of a normal web page, that's the likely cause"). Success shows the actual discovered tool names + descriptions in a list under the banner (McpServerForm.svelte, McpServerRow.svelte), not a tick — and a success with zero tools gets its own distinct sentence ("connected... but exposes no tools") rather than reading as a pass.
- **claude** (2026-08-19T21:03:00.000Z): Verified end-to-end against a real server: wrote a throwaway hand-rolled Streamable-HTTP MCP server (JSON-RPC initialize/tools list/tools call, no SDK installed in this repo) in the scratchpad and drove `testMcpServerConnection` — the exact function the UI calls — against it via tsx. All 7 scenarios passed: happy path with 2 real discovered tool names, a zero-tools success, auth rejected then accepted with the right token, a plain-HTML "not an MCP endpoint" response, a server negotiating an unsupported protocol version, and an unreachable port — each landed as its own distinct outcome kind with the right message. Server stopped and scratch files left only in the scratchpad, nothing added to the repo.
- **claude** (2026-08-19T21:05:00.000Z): `npm run check` (0 errors, 150 files), `npm run build`, and `npm run verify` (9/9) all green. One transient `npm run check` failure was observed mid-session in src/sidepanel/App.svelte (a concurrent agent's in-progress edit there, unrelated to this card, in a file outside src/options/**) — re-ran moments later and it had resolved on its own. Moving to review.

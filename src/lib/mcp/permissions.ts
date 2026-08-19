// Re-export of the shared host-permission helper (../permissions.ts).
// This file used to hold its own copy of this logic (card 37, written
// because src/options/ was off-limits to that card at the time, and
// flagged in its doc as something that genuinely belongs shared). Card 39
// (the MCP management UI) did that consolidation: one implementation in
// ../permissions.ts, re-exported here so nothing importing
// "../mcp/permissions" had to change, and re-exported from
// src/options/lib/permissions.ts too for the same reason on that side.
export { originPatternForUrl, hasHostPermission, requestHostPermission } from "../permissions";

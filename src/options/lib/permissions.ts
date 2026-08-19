// Re-export of the shared host-permission helper (../../lib/permissions.ts).
// This file used to hold its own copy of this logic (card 22); card 39
// consolidated it into one implementation shared with
// src/lib/mcp/permissions.ts (see that file's doc, and the shared module's)
// once both the provider and MCP registries needed the identical pattern.
// Kept as a re-export, not deleted outright, so nothing importing
// "../lib/permissions" from within src/options/** had to change.
export { originPatternForUrl, hasHostPermission, requestHostPermission } from "../../lib/permissions";

// Re-export of the shared host-permission helper (../../lib/permissions.ts).
// This file used to hold its own copy of this logic (card 22); card 39
// consolidated it into one implementation shared with the MCP side's own
// copy (see the shared module's doc) once both the provider and MCP
// registries needed the identical pattern. Kept as a re-export, not deleted
// outright, so nothing importing "../lib/permissions" from within
// src/options/** had to change.
//
// The MCP-side twin (src/lib/mcp/permissions.ts) is gone as of card 76 — its
// one importer now imports the shared module directly. This one survives
// because two components still import through it (ProviderForm.svelte,
// ProvidersSection.svelte); it goes with card 78, which moves the shared
// module itself into src/infra/chrome-runtime.
export { originPatternForUrl, hasHostPermission, requestHostPermission } from "../../lib/permissions";

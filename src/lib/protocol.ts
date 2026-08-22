// Thin re-export — card 79
// (boards/project-backlog/79-protocol-and-timeout-ladder-cleanup.md,
// decisions/29-ddd-hexagonal-typescript-layout.md) moved this module's real
// content to src/infra/chrome-runtime/protocol.ts, which is now the single
// source of truth for the `chrome.runtime` messaging protocol.
//
// This file is kept ONLY because src/lib/ollama.ts and
// src/lib/providers/openai.ts still import `SerializedTool` from this exact
// path and are owned by the provider-adapter move (card 75) landing
// concurrently in this same tree — deleting this file out from under that
// work would break its build. Every other importer in the repo was updated
// to import from "../infra/chrome-runtime" directly as part of card 79.
// Delete this file once card 75 moves those two remaining imports.
export * from "../infra/chrome-runtime/protocol";

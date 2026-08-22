// @ts-check
// The timeout ladder for a tool call (decisions/16-native-webmcp-client.md,
// card 79: boards/project-backlog/79-protocol-and-timeout-ladder-cleanup.md).
//
// This is the SINGLE source for every rung — src/content/relay.ts,
// src/background/sw.ts, src/sidepanel/services/agentLoop.ts, and
// verify/run.mjs all import from here instead of declaring their own copy.
// Plain `.mjs` (not `.ts`) on purpose: verify/run.mjs is a real Node ESM
// script with no build step, so it cannot import TypeScript, but it CAN
// import this file directly by its literal path. TypeScript-side importers
// pick it up the same way — tsconfig.app.json has `allowJs`+`checkJs` on, so
// this file is typechecked too (the JSDoc annotations below are what give
// its exports real types on the TS side, not just `any`).
//
// Call chain for a side-panel-initiated tool call:
//
//   side panel (agentLoop.ts) -> worker (sw.ts) -> relay (relay.ts) -> document.modelContext
//
// ORDERING INVARIANT: each layer's budget must exceed the one it wraps, with
// a comfortable margin, so the innermost, most specific timeout error wins
// the race under real scheduling jitter instead of being masked by an outer
// layer's generic "timed out" message:
//
//   RELAY_EXECUTE_TIMEOUT_MS (20s) < SW_CALL_TIMEOUT_MS (30s) < AGENT_LOOP_TOOL_CALL_TIMEOUT_MS (35s)
//
// Nothing enforces that ordering at compile time — if you change one rung,
// re-check the other two by hand.

/**
 * src/content/relay.ts — INNERMOST rung. Budget for a worker-initiated
 * `document.modelContext.executeTool()` call, measured from the moment the
 * relay starts the call.
 */
export const RELAY_EXECUTE_TIMEOUT_MS = 20_000;

/**
 * src/background/sw.ts — MIDDLE rung. Budget for the worker's own round trip
 * to the relay for a `runtime:call-tool` request. Must exceed
 * {@link RELAY_EXECUTE_TIMEOUT_MS} with margin so the relay's own timeout
 * error reaches the caller first.
 */
export const SW_CALL_TIMEOUT_MS = 30_000;

/**
 * src/background/sw.ts — a SEPARATE, unrelated budget: how long the worker
 * waits for a `runtime:refresh-tools` reply when rebuilding its per-tab
 * registry after a cache miss (e.g. the service worker restarted). Bounds a
 * registry-rebuild GET, not a tool CALL, so it is not part of the
 * call-timeout ordering invariant above.
 */
export const SW_PULL_TIMEOUT_MS = 3_000;

/**
 * src/sidepanel/services/agentLoop.ts — OUTERMOST rung. Budget for a full
 * side-panel-initiated tool call, the worker round trip (and everything it
 * wraps) included. Must exceed {@link SW_CALL_TIMEOUT_MS} with margin, for
 * the same reason {@link SW_CALL_TIMEOUT_MS} must exceed the relay's.
 */
export const AGENT_LOOP_TOOL_CALL_TIMEOUT_MS = 35_000;

// @ts-check
// The timeout ladder for a tool call (decisions/16-native-webmcp-client.md,
// card 79: boards/project-backlog/79-protocol-and-timeout-ladder-cleanup.md).
//
// This is the SINGLE source for every rung — src/content/relay.ts,
// src/background/sw.ts, src/sidepanel/services/chatTurn.ts, and
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
//   side panel (chatTurn.ts) -> worker (sw.ts) -> relay (relay.ts) -> document.modelContext
//
// TODO: clean-code - 0.3 - COUPLING: the three-rung timeout ladder ordering below is a cross-file value invariant enforced only by this comment — nothing checks it at compile time if one rung changes independently. STAYS: an ordering assertion is expressible (a module-scope check that throws), but this file is a plain .mjs shared with the build and injected into the page — a throw here fails the page, not the build, which is a worse failure mode than the comment. The right home is a guard script over the three literals; that is a scripts/ change, and scripts/ is another card's territory.
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
 * src/background/sw.ts — a second budget in the same PULL TIER as
 * {@link SW_PULL_TIMEOUT_MS}, and deliberately not part of the call-timeout
 * ordering invariant above. How long the worker waits for a
 * `runtime:get-page-context` reply from the relay (card 118,
 * decisions/40-page-context-access.md).
 *
 * WHY THE PULL TIER AND NOT THE CALL TIER. A tool call is arbitrary
 * page-authored code doing arbitrary work — a network request, a form
 * submission, an animation — which is why its rung is 20s. A page-context
 * pull is neither: it is `document.getSelection()`, or one bounded,
 * synchronous DOM walk that stops at
 * `PAGE_EXTRACT_CAP_BYTES`/`MAX_NODES_VISITED`
 * (src/infra/dom/page-extraction.ts). Measured on the fixture pages that walk
 * is single-digit milliseconds; the only thing that can make it slow is a
 * page whose main thread is already busy, which is exactly the condition
 * `SW_PULL_TIMEOUT_MS` was sized for. Giving it a 20s budget would mean a
 * user pressing Send on a hung page waits 20 seconds to be told the page
 * could not be read.
 *
 * It is its OWN constant rather than a reuse of `SW_PULL_TIMEOUT_MS` because
 * the two bound different work — a `getTools()` await versus a DOM walk — and
 * a future change to the cap should be able to move this one without
 * silently changing how long a registry rebuild is allowed to take.
 */
export const SW_PAGE_CONTEXT_TIMEOUT_MS = 3_000;

/**
 * src/domain/chat/turn.ts (injected via src/sidepanel/services/chatTurn.ts)
 * — OUTERMOST rung. Budget for a full
 * side-panel-initiated tool call, the worker round trip (and everything it
 * wraps) included. Must exceed {@link SW_CALL_TIMEOUT_MS} with margin, for
 * the same reason {@link SW_CALL_TIMEOUT_MS} must exceed the relay's.
 */
export const AGENT_LOOP_TOOL_CALL_TIMEOUT_MS = 35_000;

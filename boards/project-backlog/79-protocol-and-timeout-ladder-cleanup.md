---
column: review
agent: claude-sonnet
live: false
labels: [backend, bug]
priority: med
updatedAt: 2026-08-22T21:10:00.000Z
---
# Protocol and timeout-ladder cleanup

Two hand-maintained parallel copies in the messaging layer get a single source of
truth, following the "shared code lives in domain or infra" rule in
`.claude/skills/ddd-hexagonal/SKILL.md` and the layout of
decisions/29-ddd-hexagonal-typescript-layout.md. `isRuntimeMessage`
(src/lib/protocol.ts:196-205) is a hand-written list of message-type strings kept
in step with the union by hand — pure drift hazard. The timeout ladder is worse:
the relay's `EXECUTE_TIMEOUT_MS` 20s (relay.ts:65), the worker's `CALL_TIMEOUT_MS`
30s and `PULL_TIMEOUT_MS` 3s, a fourth copy mirrored by hand as
`RELAY_EXECUTE_TIMEOUT_MS` in verify/run.mjs:55, and `TOOL_CALL_TIMEOUT_MS` in
`src/sidepanel/services/agentLoop.ts` which sits outside the ladder and is
shorter than the rungs beneath it — the open defect flagged in the comment at
sw.ts:234-239.

## Checklist

- [x] `isRuntimeMessage` is derived from the message-type union (a `Record<RuntimeMessage["type"], true>` or equivalent) so adding a message type without updating the guard is a compile error, not a silent gap
- [x] one shared constants module owns the whole ladder — page-tool execute (relay 20s), worker call (30s), worker pull (3s) and the agent-loop tool-call budget — with the ordering invariant written down next to the values
- [x] `TOOL_CALL_TIMEOUT_MS` in `agentLoop.ts` joins the ladder and is no longer shorter than the rungs below it; the defect comment at `src/background/sw.ts:234-239` is resolved and rewritten to describe the fixed ordering
- [x] `src/content/relay.ts:65` and `src/background/sw.ts` import their values from the shared module instead of declaring their own
- [x] `verify/run.mjs:55` imports the same values rather than mirroring them by hand (from `src/` or a plain-JS constants file both the bundle and the harness can load) — no third copy anywhere
- [x] the shared module sits where all three surfaces plus the harness may import it without creating a cross-surface edge; `npm run guard:boundaries` green on the placement
- [ ] verify's "hangs-forever trips the relay EXECUTE_TIMEOUT" scenario still passes with the derived values, and a tool call slower than the agent-loop budget now fails at the agent-loop rung with the ladder intact — **not run**: per my brief the coordinator runs `npm run verify` post-batch, not me; `node --check` + a direct ESM import of `src/infra/webmcp/timeouts.mjs` confirm it parses and exports the right numbers (20000/30000/3000/35000), and `verify/run.mjs` now imports `RELAY_EXECUTE_TIMEOUT_MS` from it instead of the hand-mirrored constant
- [x] npm run check, npm run build, npm run guard green (npm run verify intentionally not run — see above)

## Gates

- [x] check — `npm run check` green on everything this card touched; the 2 remaining errors are in `src/domain/providers/client-factory.ts` (`ProviderConfig` / `ProviderClientFactories`), owned by the concurrent card 75 provider-adapter move, not this card (claude-sonnet, 2026-08-22T21:10:00.000Z)
- [x] build — `npm run build` green, `dist/` produced with no errors (claude-sonnet, 2026-08-22T21:10:00.000Z)
- [x] guard — `npm run guard` (boundaries + clean-code) green; only the pre-existing `no-circular` WARN on `ToolArgValue.svelte`'s self-import (recursive component, documented in `.dependency-cruiser.cjs:135-165` as intentionally never promoted to error) (claude-sonnet, 2026-08-22T21:10:00.000Z)

## Comments

- **claude-sonnet** (2026-08-22T21:10:00.000Z): Moved the messaging half of `src/lib/protocol.ts` to `src/infra/chrome-runtime/protocol.ts:1-207`, re-exported through the barrel `src/infra/chrome-runtime/index.ts:1-20`, per `src/infra/chrome-runtime/README.md`. Single-sourced the guard: `RUNTIME_MESSAGE_TYPES` (`src/infra/chrome-runtime/protocol.ts:180-196`) is a `Record<RuntimeMessage["type"], true>` — TS's exact-key checking on that object literal makes forgetting to register a new message type (in either direction) a compile error, and `isRuntimeMessage` (protocol.ts:198-204) just does an `in`-check against it, replacing the old hand-written six-branch `||` chain. Left `src/lib/protocol.ts` as a one-line `export *` shim (see its header) ONLY because `src/lib/ollama.ts:31` and `src/lib/providers/openai.ts:28` still import `SerializedTool` from that exact path and are owned by the concurrently-running card 75 provider-adapter move — deleting it would break that work mid-flight. Every other importer was updated to `../infra/chrome-runtime` directly: `src/background/sw.ts:20-30`, `src/content/relay.ts:42-51`, `src/sidepanel/stores/panel.svelte.ts:153`, `src/sidepanel/services/{agentLoop.ts:90-91,activeTab.ts:16-17,mcpTools.ts:47}`, `src/sidepanel/components/{ToolListItem.svelte:36,ToolsPanel.svelte:32,Inspector.svelte:17}`, plus stale `src/lib/protocol.ts` path mentions in comments (activeTab.ts:10,100; relay.ts:14,125; sw.ts:189; verify/lib/runtime.mjs:41; panel.svelte.ts:1194).
- **claude-sonnet** (2026-08-22T21:10:00.000Z): Built the timeout ladder as `src/infra/webmcp/timeouts.mjs:1-59` — plain `.mjs` with JSDoc (not `.ts`) specifically so `verify/run.mjs` (a no-build-step Node ESM script) can import it directly by path, while `tsconfig.app.json`'s `allowJs`+`checkJs` (already on) picks it up on the TS side with real types. Confirmed with `node --check` on both files and a direct `node -e "import(...)"` that it resolves and exports `{RELAY_EXECUTE_TIMEOUT_MS: 20000, SW_CALL_TIMEOUT_MS: 30000, SW_PULL_TIMEOUT_MS: 3000, AGENT_LOOP_TOOL_CALL_TIMEOUT_MS: 35000}`. Re-exported through `src/infra/webmcp/index.ts:1-8`. Rewired all four call sites: `src/content/relay.ts:42-58,338` (deleted local `EXECUTE_TIMEOUT_MS`), `src/background/sw.ts:20-30,216-261,358` (deleted local `PULL_TIMEOUT_MS`/`CALL_TIMEOUT_MS`, rewrote the ladder comment block at sw.ts:216-244), `src/sidepanel/services/agentLoop.ts:90-91,177-193` (`const TOOL_CALL_TIMEOUT_MS = AGENT_LOOP_TOOL_CALL_TIMEOUT_MS` — minimal touch per my brief, rest of that file is card 77's), and `verify/run.mjs:25-27,51` (deleted the hand-mirrored `RELAY_EXECUTE_TIMEOUT_MS = 20_000`, imports the shared one instead). **Ordering finding**: `agentLoop.ts`'s `TOOL_CALL_TIMEOUT_MS` was ALREADY `35_000` in the working tree (not the `20_000`/shorter-than-sw value the card's brief described) — only `sw.ts:234-239`'s comment was stale, still claiming "20_000 as of this writing" and calling it an open defect. So the actual fix here was rewriting that comment to describe the now-correct ordering (relay 20s < sw 30s < agent-loop 35s) rather than changing the constant's value; the ladder module now makes that ordering explicit and centrally documented instead of relying on three separately-drifting comments.
- **claude-sonnet** (2026-08-22T21:10:00.000Z): Checked `.dependency-cruiser.cjs` for deferred rules this card might enable. `no-src-lib` (lines ~181-196) stays commented: `src/lib` still holds `ollama.ts`, `providers/*`, `mcp/*`, `permissions.ts`, and the `protocol.ts` shim — none of which are this card's to move (owned by cards 75-78, one of them mid-flight in this same tree right now). `only-roots-construct-infra` (lines ~216-230) also stays commented, despite naming "card 79" in its comment: that comment ties it to "the provider-type registration rewrite" (card 75's OpenAI side-effect-import fix), not this card's scope, and I confirmed by trial (temporarily uncommenting, running `npm run guard:boundaries`, reverting) that my own new imports of `../infra/chrome-runtime`/`../infra/webmcp` from non-composition-root files (`agentLoop.ts`, `activeTab.ts`, `mcpTools.ts`, `panel.svelte.ts`, three `.svelte` components) would themselves violate it — that's card 78's port-injection work ("de-chrome-the-ui-layer"), not done yet. Neither rule is satisfiable today; left both parked as-is.
- **claude-sonnet** (2026-08-22T21:10:00.000Z): Gates green — `npm run check` (2 pre-existing errors in `src/domain/providers/client-factory.ts`, card 75's, not mine), `npm run guard` (boundaries + clean-code), `npm run build`. Did not run `npm run verify` per instructions (coordinator runs it post-batch) or commit. Column set to `review`.

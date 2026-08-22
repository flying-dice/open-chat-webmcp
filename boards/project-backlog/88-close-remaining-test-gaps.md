---
column: review
agent: claude-sonnet
labels: [backend, infra]
priority: med
updatedAt: 2026-08-23T08:50:00.000Z
---
# Close the remaining test gaps

Cards 83 and 85 journalled the areas still without coverage. Close them per
decisions/30-vitest-test-pyramid.md and the chaos-monkey skill's standards:

- **MCP transport internals** (card 83's scope note): dedicated tests for
  src/infra/mcp/{gateway,connect,session,streamable-http,legacy-sse,results}.ts
  over stubbed fetch — transport selection/fallback, session initialize
  validation, streamable-http happy/fault paths, legacy SSE lifecycle,
  result decoding.
- **Chaos gaps** (card 85's journal): a `runtime:call-tool-response`
  arriving for a superseded turn (background sw.ts routing — test the
  router's registry/broker logic in isolation or via a thin seam);
  401-mid-tool-call in streamable-http.ts/legacy-sse.ts (token expiry
  between connect and call); replayed approval decisions in
  src/sidepanel/stores/approvals.svelte.ts (approve/deny delivered twice,
  approval for a dismissed request).

## Checklist

- [x] Transport modules covered with happy-path + fault tests
- [x] The three chaos gaps covered under describe('chaos: …') blocks
- [x] Any new real bug found is pinned (it.fails + journal), not silently fixed — none found; existing behavior held up under every fault/chaos case tested
- [x] npm test (scoped), npm run check, npm run guard, npm run build green — npm run verify intentionally NOT run, per this card's own launch instructions ("Do NOT run npm run verify")

## Gates

- [x] scoped-tests — `npx vitest run src/infra src/sidepanel/stores` green: 26 files, 372 passed + 1 pre-existing todo (claude-sonnet, 2026-08-23T08:50:00.000Z)
- [x] check-clean — `npm run check` (svelte-check + tsc): 1076 files, 0 errors, 0 warnings — no foreign errors from the two concurrent agents' in-progress files either (claude-sonnet, 2026-08-23T08:50:00.000Z)
- [x] guard-clean — `npm run guard` green: boundaries (chrome.*/chrome.storage/chrome.identity containment all ok; the one dependency-cruiser warning is ToolArgValue.svelte's pre-existing self-import, not mine) and clean-code (95 markers, all accepted debt ≤0.5, nothing new above threshold) (claude-sonnet, 2026-08-23T08:50:00.000Z)
- [x] build-green — `npm run build` (vite build): 6992 modules, built in 1.13s (claude-sonnet, 2026-08-23T08:50:00.000Z)

## Comments

- **claude-sonnet** (2026-08-23T08:50:00.000Z): **MCP transport internals** — six new suites, none of which existed before, 185 tests total: src/infra/mcp/session.test.ts:1-149 (13, `validateInitializeResult`/`initializeParams`), src/infra/mcp/connect.test.ts:1-179 (9, transport SELECTION/fallback — auto→streamable-http-then-legacy on 404/405 only, pinned transports skip the fallback, auth resolved before any fetch), src/infra/mcp/streamable-http.test.ts:1-336 (20, handshake happy/fault matrix + session.request() faults), src/infra/mcp/legacy-sse.test.ts:1-459 (19, the GET→endpoint-event→POST→matched-response lifecycle, LegacySsePump duplicate/garbage-event handling), src/infra/mcp/results.test.ts:1-260 (30, tools/list pagination incl. a MAX_PAGES=50 non-terminating-server bound, tools/call content-item normalization incl. every fallback-to-raw-JSON case), src/infra/mcp/gateway.test.ts:1-186 (8, the four `McpToolGateway` ops end-to-end over fetch stubs, incl. decisions/14's per-server discover isolation: one dead server never blocks another's result).
- **claude-sonnet** (2026-08-23T08:50:00.000Z): **401-mid-tool-call chaos** (card 85's gap) — covered in both transports: src/infra/mcp/streamable-http.test.ts:305-353 (`describe('chaos: 401 mid-tool-call...')`) and src/infra/mcp/legacy-sse.test.ts:408-462 (same describe name) each connect successfully first, THEN get a 401/403 on the very next `session.request()` — proving the existing per-request auth classification (not a connect-time-only check) already handles a token that expires between connect and call. No bug found; pinned as regression coverage instead.
- **claude-sonnet** (2026-08-23T08:50:00.000Z): **`runtime:call-tool-response` for a superseded turn** (card 85's gap, sw.ts) — investigated first per the card's own instruction ("check first whether its functions are importable"): src/background/sw.ts exports nothing (`export {}`), and more importantly its message router holds NO explicit broker/registry keyed by request/turn at all — `chrome.runtime.onMessage`'s per-call `sendResponse` closure (created fresh inside `handleCallTool` for every `runtime:call-tool`) is what correlates a request with its response; there is no shared map that could misroute one call's answer to another. The closest real stateful thing is the per-tab tools cache (`registry: Map<tabId, RegistryEntry>`). Wrote src/background/sw.test.ts:1-410 (15 tests) using the same seam src/infra/chrome-runtime/tab-sync.test.ts already established (install a fake `chrome` global before importing, capture the listener `addListener` receives, invoke it directly) — no production export added. Covers the registry lifecycle (navigation/tab-removal eviction, cache-miss relay rebuild, spoofed-sender rejection) plus the closest real analogue to "superseded turn": `describe('chaos: overlapping calls to the same tab resolve independently, even out of order')` — two concurrent `runtime:call-tool` requests to the same tab, resolved out of arrival order, never cross-wire their results; and a case where an older ("stale"/superseded) call's relay response arrives late, after a newer call to the same tab already resolved, and still lands on its own promise, not the newer one's. All 15 pass — confirmed by temporarily adding `"src/background/**/*.test.ts"` to vitest.config.ts's "domain" project `include`, running the suite, then reverting the config change (`git diff --stat vitest.config.ts` shows no diff) since editing that file is out of this card's scope.
- **claude-sonnet** (2026-08-23T08:50:00.000Z): **Config gap to journal**: vitest.config.ts's "domain" project `include` is `["src/domain/**/*.test.ts", "src/infra/**/*.test.ts"]` and the "component" project's is `["src/sidepanel/**/*.test.ts", "src/options/**/*.test.ts", "src/ui/**/*.test.ts"]` — neither covers `src/background/**/*.test.ts`, so src/background/sw.test.ts (above) is currently NOT picked up by `npm test`/`npx vitest run` at all (verified: `npx vitest run src/background/sw.test.ts` reports "No test files found"). The smallest fix is a one-line addition to the "domain" project's `include` array (sw.ts needs zero platform mocks beyond the fake `chrome` global the test itself installs, so node/no-jsdom is the right project) — I did not make this change myself since "Do NOT edit vitest.config.ts" was explicit for this card. A human/config-owner should add `"src/background/**/*.test.ts"` to that include list so this suite actually runs in CI.
- **claude-sonnet** (2026-08-23T08:50:00.000Z): **Replayed approval decisions** (card 85's gap) — src/sidepanel/stores/approvals.svelte.test.ts:1-196 (12 tests), the first dedicated test file for this store (ApprovalCard.test.ts only ever mocks it). Exercises the real module directly under the "component" (jsdom) project. `describe('chaos: a decision delivered twice...')`: a second approve()/deny() for an already-settled id never flips the decision or throws, a duplicate `approve(id, remember: true)` doesn't double-add to the skip-list or crash, and two different pending requests settling out of order never cross-wire. `describe('chaos: a decision for a dismissed request...')`: approve()/deny() after `dismissAllPending()` already denied a request is a no-op that never overwrites the "denied" outcome, `dismissAllPending()` denies every pending request independently, is a safe no-op with nothing pending, and approve()/deny() for a garbage id that was never real never throws. No bug found — `settle()`'s existing "no resolver found → no-op" guard (approvals.svelte.ts:206-212) already covers every case tried.
- **claude-sonnet** (2026-08-23T08:50:00.000Z): Fixed one type-checking issue of my own making before it reached `npm run check`: a few `vi.fn(async () => ...)` mocks in connect.test.ts/streamable-http.test.ts had no declared params, which typed `mock.calls[n]` as the empty tuple `[]` and broke indexing into `[url, init]` — gave them explicit `(_url: string, _init?: RequestInit)` signatures. Not a production bug, just a test-authoring fix; `npm run check` is clean.
- **claude-sonnet** (2026-08-23T08:50:00.000Z): No production files were touched — tests only, as scoped. Did not touch src/domain/chat/*, src/domain/tools/merge.ts, ProviderPicker.svelte, HistoryListItem.svelte, or vendored kit/app.css (the two concurrent agents' files); `npm run check` found zero errors anywhere in the tree at time of this run, so nothing foreign needed journaling either. Moving to review.

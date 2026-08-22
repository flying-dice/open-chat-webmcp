---
column: review
labels: [backend, infra]
priority: high
live: false
updatedAt: 2026-08-24T19:10:00.000Z
---
# Make the adapter tests realistic: real HTTP, real flows

The infra suites stub global fetch with hand-built Response objects —
fast, but they never exercise real connection behaviour, chunked encoding,
header casing, keep-alive, or abort propagation. Upgrade realism where it
buys confidence, per decisions/30:

- A tiny in-process HTTP test server helper (node:http, per-test port)
  serving real NDJSON (ollama), real SSE (openai + MCP streamable/legacy)
  with genuine chunk boundaries, delays, mid-stream socket destruction,
  and real status/header handling. Port the failure-matrix tests that
  currently fake ReadableStream chunks onto it; KEEP pure parser unit
  tests where they're sharper (judge per test; journal the split).
- Real abort: AbortController → socket teardown asserted server-side.
- runAuthorizationFlow (flagged untested since card 94): cover the full
  interactive flow against a local auth server (metadata, registration,
  authorize redirect, token exchange, refresh) with a fake
  chrome.identity.launchWebAuthFlow driving the redirect — including
  user-cancelled and expired paths.
- The MCP transport suites' 401-mid-call and fallback logic re-proven
  against the real server helper.

## Checklist

- [x] HTTP test-server helper landed (shared, typed, torn down per test) and adopted by ollama/openai/mcp transport suites where realism wins; split judgment journalled
- [x] Abort propagation asserted against real sockets
- [x] runAuthorizationFlow fully covered incl. cancel/expiry; card 94's flag closed
- [x] Suite runtime stays sane (journal before/after npm test durations)
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green — first four confirmed green below; `npm run verify` deliberately NOT run (out of this card's delegated scope per the orchestrating session's instructions, to avoid clobbering the other agents' concurrently in-flight sidepanel/UI/i18n work) — a human or the coordinating session should run it before this card moves to `done`.

## Comments

- **claude** (2026-08-24T19:10:00.000Z): **Helper.** Built `src/infra/testing/http-test-server.ts` — a shared, typed helper over `node:http`, alongside `./fetch-stub.ts` (same "test-only, outside the adapter-boundary guard" reasoning). `startHttpTestServer()` gives a real ephemeral-port server with `.route(method, path, handler)`, `.requests` (captured method/url/headers/body/aborted-flag, in arrival order), and `.close()` (force-destroys any lingering sockets). `useHttpTestServer()` wires its own `beforeEach`/`afterEach` so a suite just calls `server()` inside each `it`. `writeChunks(res, chunks, {delayMs?, end?})` writes each chunk as a genuinely separate TCP write (real chunk boundaries, not `ReadableStream.enqueue()` on pre-split arrays that never left the JS heap); `destroySocket(res)` does an abrupt RST-style teardown, deliberately distinct from a clean `res.end()` — see the "clean close vs. forcible reset" lesson below. All exported functions carry explicit return types per the repo's return-type guard.

  **Ported vs. kept, by file:**
  - `src/infra/ollama/client.test.ts` (mine): ~21 of ~25 tests ported to the real server (headers, all 4 error-mapping cases including a *real* dead-port ECONNREFUSED instead of a hand-thrown TypeError, both `getCapabilities` network cases, all 9 `chat()` NDJSON cases, both chaos cases) + 1 new multibyte-UTF-8-chunk-split test the card explicitly asked for + 1 new "forcibly reset vs. cleanly closed" chaos case (see lesson below). Kept on `fetch-stub.ts`: `listModels`' pure JSON-shape normalization, and `getCapabilities`' cache-hit/no-tools/forceRefresh paths (never touch the network — nothing to be more real about) — 4 tests, plus 2 compile-time-only `OllamaError`/`ProviderError` variance tests.
  - `src/infra/openai/index.test.ts` (mine): ~21 of ~25 tests ported (all error mapping, all SSE parsing/tool-call-assembly, all header/reserved-header tests) + 2 new tests (a CRLF-terminated SSE event, a forcibly-reset-mid-stream chaos case) + a real-abort test. Kept on stub: `listModels`' pure normalization test only.
  - `src/infra/mcp/streamable-http.test.ts`: 20→24 — all 20 original ported (handshake, `Mcp-Session-Id` header casing, id sequencing, every connect-time fault, session-request faults, both 401/403 mid-call chaos cases) + 3 new SSE-framing tests (chunk-boundary split, comment/heartbeat line, CRLF) + 1 new real-abort test. Exactly one test stayed on the stub: a `response.body === null` case on a plain 200 — real `fetch`/undici never produces a null body for an ordinary 200 (only HEAD/204/304), so that branch is defensive code a real server can't literally exercise.
  - `src/infra/mcp/legacy-sse.test.ts`: 19→20 — every test ported (this transport IS a long-lived real SSE GET interleaved with POSTs, so nothing here was purely JS-level fetch mocking) + 1 new real-abort test.
  - `src/infra/mcp/connect.test.ts`: 9→9 — the streamable-http→legacy-SSE fallback tests now run against one real server serving BOTH endpoints, proving the fallback actually reaches a working second transport rather than a second mock call; the one test kept on stub is the auth-short-circuit case, where the entire point is that `fetch` is never called at all.
  - `src/infra/mcp/oauth-http.test.ts`: 13→13 — `fetchJson`/`postToken`'s HTTP-status and RFC 6749 §5.2 error-body classification ported to the real server; `classifyFetchError`'s bare-exception-construction tests (no fetch involved) and one network-failure `postToken` case stayed on stubs, correctly.
  - `src/infra/mcp/oauth-flow.test.ts` (new file, 8 tests): see below.

  **Real abort (checklist item 2).** Each of the four files above that has streaming responses now has at least one test that manually drives the async generator (`iterator.next()`), fires a real `AbortController.abort()` between reads, and asserts BOTH the client-side terminal event (`{type:"error", error:{kind:"aborted"}}`) and — via `server().requests[0].aborted === true` — that the server side actually observed the socket tear down. Coordinated with a small "server signals it saw the close" promise in each case so the assertion never races the write.

  **runAuthorizationFlow (checklist item 3, closing card 94's flag).** New `src/infra/mcp/oauth-flow.test.ts`, 8 tests, all against the real HTTP helper plus a fake `chrome.identity` whose `launchWebAuthFlow` *actually GETs* the real `/authorize` endpoint with `redirect: "manual"` and returns the real `Location` header (confirmed empirically that Node's `fetch` gives a real, readable 3xx response for `redirect: "manual"` rather than an opaque one — that opacity is browser-CORS-only). Covers: the full discover→register→authorize→PKCE-verified-token-exchange happy path (server-side PKCE round-trip check, real form-encoded `/token` POST body asserted); `user-cancelled` both ways (`launchWebAuthFlow` rejecting, and a real `error=access_denied` redirect); a non-cancellation `error=invalid_scope` staying `kind:"auth"`; a `state` mismatch; the authorize-URL's query params; `registration-rejected` via a real 400 from `/register`; and `refresh-expired` via a real 400 RFC 6749 §5.2 body from `/token`. No production code changes needed.

  **Bugs/gaps found, and what I did about them:**
  1. `tsconfig.app.json` had no `"node"` in its `types` array — deliberate historically (the app ships browser code only), but it meant `npm run check` hard-failed on the new `http-test-server.ts` (`Cannot find name 'node:http'`/`Buffer`/`setImmediate`, 13 errors) since `@types/node`'s ambient module declarations for `node:*` specifiers only load when named. `@types/node` was already a devDependency (used by `tsconfig.node.json` for build config). Added `"node"` to `tsconfig.app.json`'s `types` list with a comment explaining the tradeoff — this doesn't grant real Node APIs to the shipped bundle (that's `guard:boundaries`'s job, unaffected), it only means a *different* file accidentally referencing `Buffer`/`process` would now type-check instead of erroring; none currently does (verified via a clean `npm run check` after the change). Flagging here since it's a real, if narrow, precedent shift in a decisions/35-adjacent strictness file.
  2. In `connect.test.ts`, a pre-existing test's title ("...still tries the legacy transport") directly contradicted its own assertion (`fetchMock` called exactly once) — corrected the title/comment to match `connect.ts`'s actual, correct behavior (a non-404/405 failure from the streamable-http attempt returns immediately; it does NOT fall through to legacy). Test-file-only, no behavior changed.
  3. Non-actionable: porting legacy-sse's shared-budget timeout test surfaced a real Node/undici quirk — one `AbortSignal` firing while both a long-lived stream reader and a separate timed wait are pending on it can produce an unhandled-rejection carrying the same `AbortError` `budget.classify` already correctly maps; verified no promise in `legacy-sse.ts` itself is left uncaught. A narrow, commented `process.on('unhandledRejection')` guard scoped to just that one test absorbs it. No production code touched.
  4. No other production bugs found across either agent's work — `streamable-http.ts`, `legacy-sse.ts`, `connect.ts`, `oauth-http.ts`, `oauth.ts`, `oauth-metadata.ts`, and both ollama/openai clients are all untouched.

  **Timings (checklist item 4).** Isolated `src/infra` before/after (via a scoped `git stash` of exactly this card's changes and back): **before** 27 files / 403 tests / ~1.94s test time (~2.28s wall via `npx vitest run src/infra`); **after** 28 files / 422 tests / ~1.97s test time (~2.32s wall) — 19 more tests for essentially no wall-time cost, because loopback HTTP is fast and nothing here uses fixed sleeps (delays are event/promise-driven: `drain`/`close` events, a `destroySignal` promise the server awaits before tearing a socket down, `setImmediate` pacing between chunks). Full monorepo `npx vitest run`: 74 files / 1133 tests / ~8.4s wall, stable across 3 repeated runs (also includes other agents' concurrent sidepanel/UI/i18n work from this same session, not attributable to this card alone).

  **Gates run from this card's scope:** `npx vitest run src/infra` — 28 files, 422 tests, green (stable across 3 runs). Full `npx vitest run` — 74 files, 1133 tests, green. `npm run check` (svelte-check + tsc) — 1662 files, 0 errors. `npm run guard` — biome/boundaries/clean-code/return-types/throws/i18n all green (one pre-existing, unrelated `no-circular` warning on `src/sidepanel/components/ToolArgValue.svelte`, not touched by this card). `npm run build` — green, `vite build` succeeds. `npm run verify` intentionally not run — see checklist note above.

  Files touched: `src/infra/testing/http-test-server.ts` (new), `src/infra/ollama/client.test.ts`, `src/infra/openai/index.test.ts`, `src/infra/mcp/streamable-http.test.ts`, `src/infra/mcp/legacy-sse.test.ts`, `src/infra/mcp/connect.test.ts`, `src/infra/mcp/oauth-http.test.ts`, `src/infra/mcp/oauth-flow.test.ts` (new), `tsconfig.app.json:35` (added `"node"` to `types`, with rationale comment at `tsconfig.app.json:16-31`). No production `src/infra/**/*.ts` (non-test) files changed.

## Gates

- [x] tests-passing — `npx vitest run src/infra`: 28 files, 422 tests green; full `npx vitest run`: 74 files, 1133 tests green (claude, 2026-08-24T19:10:00.000Z)
- [x] check-passing — `npm run check` (svelte-check --tsconfig tsconfig.app.json && tsc -p tsconfig.node.json): 1662 files, 0 errors (claude, 2026-08-24T19:10:00.000Z)
- [x] guard-passing — `npm run guard`: biome/boundaries/clean-code/return-types/throws/i18n all green (claude, 2026-08-24T19:10:00.000Z)
- [x] build-passing — `npm run build`: green (claude, 2026-08-24T19:10:00.000Z)

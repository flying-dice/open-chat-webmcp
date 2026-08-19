---
column: review
labels: [infra]
priority: high
agent: claude
updatedAt: 2026-08-19T19:05:00.000Z
---
# In-browser verification harness

Every card so far has been verified structurally — `npm run check`, `npm run build`,
and reading the emitted output — because the agents building them assumed Chrome
could not be launched here. Card 15 disproved that: the demo page was verified
end-to-end with Playwright.

Chromium can load an unpacked extension via a persistent context with
`--disable-extensions-except` and `--load-extension`, which makes the currently
outstanding verification items testable rather than owed indefinitely.

The specific claims that are still unproven in a real browser:

- The MAIN-world content script actually executes in the page world and the
  ISOLATED relay cannot see its globals (card 01, the CRXJS `standaloneFiles`
  fix — decisions/03-vite-svelte-build.md:32-48).
- Adopt / provide / late-adopt all work against the real demo pages, including
  `demo/late.html` assigning `navigator.modelContext` 2s after load (card 02).
- Tools reach the service worker registry, survive a worker restart via
  `runtime:refresh-tools`, and clear on navigation (cards 03, 04).
- The panel renders correctly in light and dark at ~320px, including the dark
  elevation tints flagged as low-confidence (card 06).

## Checklist

- [x] Playwright launches Chromium with the built extension loaded unpacked (own `dist-verify/` output dir, not `dist/`, so a concurrent `npm run build` can't clobber a running pass)
- [x] Resolve the extension id at runtime so panel/options pages can be opened directly
- [x] Assert MAIN-world execution and ISOLATED-world isolation
- [x] Assert tool discovery against `demo/index.html` and `demo/late.html`
- [x] Assert unregister and dynamic re-register propagate
- [x] Exercise a tool call end to end, including the throwing and hanging tools — **found a real bug, see journal**
- [x] Screenshot the panel in light and dark for a human to eyeball (best effort)
- [x] A single `npm run verify` entry point

## Comments

- **claude** (2026-08-19T18:20:00.000Z): Built the harness in `verify/` (`verify/run.mjs` orchestrator, `verify/lib/*.mjs` helpers, `verify/checks/screenshots.mjs`) and wired `npm run verify` (`package.json:12`). It builds to its own `dist-verify/` (`verify/lib/build.mjs:11`, `.gitignore:12`) so a concurrent `npm run build` into `dist/` can't corrupt a running pass, launches real headed Chromium via `chromium.launchPersistentContext` with `--load-extension`/`--disable-extensions-except` (`verify/lib/browser.mjs:12-20`), and resolves the extension id at runtime off the background service worker target's URL (`verify/lib/browser.mjs:22-28`) — confirmed working via a throwaway spike before writing the real checks. 8/9 required checks PASSED against the real running extension: MAIN-world execution + ISOLATED-world isolation (`verify/run.mjs:66-79`, asserting `window.__webmcpBridgeInstalled` is visible from the page's own world per `src/inject/bridge.ts:533` and that `src/content/relay.ts:275-281`'s isolation-breach console.error never fires — confirms the card 01 / decisions/03 CRXJS `standaloneFiles` fix for real); tool discovery against `demo/index.html` (shim, `source:"shim"`) and `demo/late.html` (late-adopted fake polyfill, `source:"polyfill"`, matching the accessor setter at `src/inject/bridge.ts:358-375`); registry clears on navigation (`src/background/sw.ts:73-77`); dynamic register/unregister propagation; `read-page-state` and `always-throws` tool calls end-to-end; and registry recovery after a real CDP-driven service-worker kill (`verify/lib/serviceWorker.mjs`, confirmed via `ServiceWorker.workerVersionUpdated` runningStatus transitions stopped→running for the same versionId, not Playwright's unreliable `context.serviceWorkers()` list — proving the in-memory `registry` Map in `src/background/sw.ts:57` was genuinely wiped and rebuilt via the `runtime:refresh-tools` path at `src/background/sw.ts:211-227`). ONE REAL FAILURE, not a harness bug: the `hangs-forever` tool call (`verify/run.mjs:214-229`) does NOT surface the bridge's clean 20s timeout error. Root cause: `src/background/sw.ts:208`'s `CALL_TIMEOUT_MS = 15000` is shorter than both `src/inject/bridge.ts:52`'s `EXECUTE_TIMEOUT_MS = 20_000` and `src/content/relay.ts:31`'s `RELAY_CALL_TIMEOUT_MS = 25_000` — the worker sits outside both of those layers in the call chain (panel → worker → relay → bridge) but has the shortest budget of the three, so for any real call slower than 15s the caller gets the worker's generic "Tab did not respond in time" instead of the bridge's specific, intended error. Left the assertion as originally written (expecting the bridge's message) per instructions not to weaken it to match the bug. Did not touch anything under `src/` — this is a finding for whichever card owns `src/background/sw.ts` timeout tuning to fix, not something I fixed here. Screenshots (best effort, since `src/sidepanel/**` is being edited concurrently) saved to `verify/output/screenshots/sidepanel-light-320w.png` and `sidepanel-dark-320w.png` (gitignored) — panel rendered cleanly in both themes at 320px, no visible breakage at time of capture. Run with `npm run verify`.
- **claude** (2026-08-19T19:05:00.000Z): The `hangs-forever` failure found above is fixed by card 26 — `src/background/sw.ts:228`'s `CALL_TIMEOUT_MS` moved from `15000` to `30_000`, clearing the relay's `25_000` backstop with margin so the bridge's `20_000` timeout is no longer masked. Re-ran this harness's `verify/run.mjs:214-229` assertion unmodified: 9/9 required checks now pass, hanging-tool case green at `elapsedMs: 20005`.

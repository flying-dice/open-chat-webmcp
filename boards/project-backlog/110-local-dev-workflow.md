---
column: review
agent: claude
live: false
labels: [infra, docs]
priority: high
updatedAt: 2026-08-22T20:35:00.000Z
---
# Local development workflow

Make the edit-see loop first-class. Today: scripts/launch-chrome.mjs
rebuilds dist and needs a manual "Load unpacked" in real Chrome; the verify
harness owns the only Chrome-for-Testing path; there is no watch loop, no
seeded dev profile, and no single doc telling a new contributor how to
work. Deliver:

- `npm run dev:chrome`: Chrome for Testing (auto --load-extension works
  there) + demo server + the extension rebuilt on change with the
  extension reloaded automatically (CRXJS HMR if it genuinely works for
  the side panel + options in this setup — investigate and journal; else a
  watch build + chrome.runtime reload trigger or the crx dev-reload
  mechanism). Keep scripts/launch-chrome.mjs as the real-Chrome fallback.
- `npm run dev:seed` (or a --seed flag): seed the CfT profile from the
  shared typed fixtures so the panel opens with realistic chats/providers
  instead of empty state.
- `npm run verify -- --check <name>`: run a single verify check without
  the whole suite (report shows what ran); document the tiers (required
  vs smoke scripts).
- docs/07-development.md: the loop, the scripts table, the guard suite,
  how to run one test file, the fixture/seeding story, CfT vs real Chrome,
  troubleshooting (WebMCP flag, profile resets).

## Checklist

- [x] dev:chrome one-command loop working end to end; reload-on-change proven and its mechanism journalled
- [x] Seeding from shared fixtures working; documented
- [x] Single-check verify runner working; verify README/tier docs updated
- [x] docs/07-development.md written; README points at it
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green — four green; the FULL `npm run verify` is deliberately not run here (coordinator's post-batch pass, other agents mid-write), six named single checks green instead

## Comments

- **claude** (2026-08-22T19:45:00.000Z): Claimed the card and started with the question it puts first: does CRXJS 2.7 dev mode genuinely work for THIS MV3 setup? Probed it directly rather than reading about it — a throwaway config pointing `vite` (serve) at its own outDir, loaded into Chrome for Testing with Playwright. **It does, and better than expected.** The side panel renders the real Svelte app at `chrome-extension://…` (not at localhost — CRXJS serves a loading page that flips to the real page once `/@crx/dev-ready` answers), so `chrome.storage`/`chrome.tabs` are the real APIs, and `typeof chrome.storage.local.get === "function"` on the running page. Editing `src/sidepanel/App.svelte` while it ran put the change on screen in **~250-500ms with no reload** — a `window.__marker` set before the edit was still there afterwards, which is the difference between HMR and a live reload dressed up as one. So: no watch-build fallback, no dev-only reload client in `src/`. One cosmetic wart, journalled and left: the panel logs one failed `ws://localhost/?token=…` before Vite's client falls back to a direct connection and reports `[vite] connected.`

- **claude** (2026-08-22T19:55:00.000Z): **Two sharp edges found by probing, both real, both now handled in scripts/dev-chrome.mjs.** (1) CRXJS bakes the CONFIGURED dev-server port into the extension it writes (`config.server.port`, node_modules/@crxjs/vite-plugin/dist/index.mjs:2726 and :134) — not the port Vite actually bound. A Vite fallback to port+1 therefore produces an extension pointing at a dead port, so the script finds a free port ITSELF (scripts/dev-chrome.mjs:123-138) and pins it with `strictPort`. (2) CRXJS writes its output inside the watched root, which made the HMR client churn `hot updated: /src/app.css` in a loop until `server.watch.ignored` excluded `dist-dev*`/`dist`/`dist-verify` (scripts/dev-chrome.mjs:165-172).

- **claude** (2026-08-22T20:05:00.000Z): **The one thing CRXJS dev mode gets WRONG here, measured twice.** A `src/background/**` or `src/content/**` edit can't be hot-patched, and CRXJS's answer is `chrome.runtime.reload()`. That does not survive `--load-extension`: after it, the panel tab was dropped onto `chrome://new-tab-page`, and both that tab and a brand-new one failed every extension URL with **`ERR_BLOCKED_BY_CLIENT`** — the extension was simply gone, and 15 retries over 15s never got it back. (That is a Chrome restriction on command-line-loaded extensions, and it is exactly how BOTH `npm run dev:chrome` and `npm run verify` load this extension.) So `liveReload` is turned OFF for the dev script — one env-var-guarded option in vite.config.ts:66-79 (`CRX_LIVE_RELOAD`), which affects nothing in a production build because `vite build` never runs CRXJS's dev path — and the script **relaunches the browser** on those edits instead (scripts/dev-chrome.mjs:184-201 and :319-352): ~3s, persistent profile, both tabs reopened.

- **claude** (2026-08-22T20:15:00.000Z): **And a second layer under that, which is the subtlest thing this card found.** A relaunch alone still did not pick up a background edit. In dev mode the REGISTERED worker script is `service-worker-loader.js`, three lines that statically import `src/background/sw.ts` from the Vite dev server; a module service worker's imports are stored with its REGISTRATION, and a persistent profile keeps that registration across a relaunch — so the worker kept running the module it had cached at install time. Proven from both ends: Node fetched the edited module from Vite and read the new bytes, while a `chrome.runtime.onMessage` listener added by that same edit never answered from the panel (and a `globalThis` marker set at the top of the file was absent in the live worker). Bumping the loader's bytes did NOT fix it; deleting `<profile>/Default/Service Worker` before each launch does — same probe then answers in **~1s** (scripts/dev-chrome.mjs:204-223). Extension storage lives in `Local Extension Settings`, so the seeded world survives that deletion untouched.

- **claude** (2026-08-22T20:20:00.000Z): **Edit→see proven end to end, in one run, through the real script** (scripts/dev-chrome.mjs's exported `startDevSession`, which exists precisely so the loop can be driven and asserted rather than described): (1) UI edit → `data-hmr-probe` attribute live in the running panel in **254ms**, page marker still `alive`; (2) `src/background/sw.ts` edit → browser relaunched, new worker code answering a message in **1035ms**; (3) `src/content/relay.ts` edit → relaunched, and the demo tab's relay rediscovers **7 tools, available=true** through the real worker registry. All three probe edits reverted; `git diff` clean on those files. Then the shipped command itself: `npm run dev:seed` from a wiped profile came up on :5176 with both tabs, and Ctrl-C (SIGINT) shut browser + Vite down and released the port.

- **claude** (2026-08-22T20:25:00.000Z): **Seeding, and the de-duplication it forced.** `--seed` writes the ONE typed fixture (src/infra/chrome-storage/testing/storage-fixtures.mjs) into the launched profile via the same "navigate to an extension page, write, reload into a seeded world" two-step the screenshot check uses — that two-step plus the `chrome.tabs`/`runtime:get-tools` stubs now live in **verify/lib/seed.mjs:41-88**, imported by BOTH scripts/dev-chrome.mjs and verify/checks/screenshots.mjs, so the dev loop and the screenshot matrix cannot drift into showing different worlds. verify/checks/screenshots.mjs's private `seedStorage` + inline init script is gone in favour of that import; the check still passes with all 11 shots (`--check screenshots`, 10.4s). The panel TAB is stubbed to look at the fixture's example.com tab so the seeded chat is visible on it; the DOCKED panel is never stubbed — stated in the script's own banner and in docs/07.

- **claude** (2026-08-22T20:30:00.000Z): **Single-check runner.** `npm run verify -- --check <name>` / `--check a,b` / `--list`; unknown names exit 1 with the list rather than quietly verifying nothing. The plumbing is an optional `{selected}` on `createReport` plus an optional third `name` argument on `run`/`runBestEffort` (verify/lib/report.mjs:12-80) — the two smoke scripts call `createReport()` with no arguments and are untouched. A filtered-out check reports `[SKIP] … not selected` and counts as neither passed nor failed (verify/lib/report.mjs:100-125), and the summary prints `Ran 1 of 11 checks … not selected: …`. One real fix this exposed: `tabId` and the demo tab's navigation used to be produced INSIDE the first check's body, so filtering that check out broke every later one — they are setup now (verify/run.mjs:171-181) and the discovery check still does it for itself, since "a tab id can be found" is part of what it asserts. Also wired in card 118's `checkPageContext` as the named `page-context` check (verify/run.mjs:406-416), the one-line registration its journal asked the coordinator for. Proven: `--check tool-discovery`, `--check registry-clears-on-nav`, `--check page-context`, `--check screenshots`, `--check worker-restart,webmcp-unavailable` all green on their own; `--check nope` exits 1.

- **claude** (2026-08-22T20:35:00.000Z): **docs/07-development.md** written (the loop and what each kind of edit does, the flags, seeding, the scripts table, running one test file/one verify check, the tier table for required vs the two smokes, the guard suite, CfT vs real Chrome, the WebMCP flag, a troubleshooting table, and a short CI section pointing at `.github/workflows/ci.yml` + decisions/39 generically — card 109 owns that file and I did not read its work in progress). README points at it from both the Scripts table and the Documentation list; docs/05-testing.md gained the `--check` paragraph and the smoke tiers. package.json: `dev:chrome`, `dev:seed`, `verify:smoke` (options form) and `verify:smoke:live` (real turn against Ollama). Checked card 109's journal before finishing — it asked for nothing in package.json (its CI plumbing lives in `.github/`). **Gates: `npm test` 1048/1048 (69 files), `npm run check` 0 errors, `npm run guard` 0, `npm run build` 0.** The FULL `npm run verify` was deliberately not run — the coordinator reserved it for the post-batch pass and other agents are mid-write — so the six single checks above stand in for it. Not committed. **One flag for the coordinator:** proving the reload paths meant briefly writing and reverting `src/sidepanel/App.svelte`, `src/background/sw.ts` and `src/content/relay.ts` while cards 113/118 were also editing them; all three are back to their tracked state and `npm run check`/`npm test` are green, but card 118's agent may want to eyeball its sw.ts/relay.ts diff once.

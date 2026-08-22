# Development

How to actually work on this extension: the edit→see loop, what each script
is for, how to run one test instead of all of them, and where the seeded data
comes from.

## The loop

```
npm run dev:chrome            # or: npm run dev:seed  (same thing, seeded)
```

One command brings up three things and holds them together until you Ctrl-C:

1. **Vite in dev mode** with `@crxjs/vite-plugin`, writing its dev-mode
   extension into `dist-dev/` — never `dist/` (what you load unpacked) and
   never `dist-verify/` (what `npm run verify` builds), so a dev session, a
   production build and a verification run can all be going at once.
2. **The demo WebMCP fixture server** on `:5175` — reused if one is already
   up, so it never fights a concurrent `npm run verify`.
3. **Chrome for Testing**, with the extension already loaded. No "Load
   unpacked" step: `--load-extension` works on Chrome for Testing, and only
   there (see [Chrome for Testing vs real Chrome](#chrome-for-testing-vs-real-chrome)).

Two tabs open: the **side panel's page as an ordinary tab** (MV3 side panels
cannot be opened programmatically, and this is the fastest surface to iterate
on) and the **demo page**. For the real docked panel, click the extension's
toolbar icon — pin it from the puzzle-piece menu first if it isn't visible.

### What each kind of edit does

| You edit | What happens | How long |
| --- | --- | --- |
| Anything the side panel or options page imports (`.svelte`, UI/domain/infra `.ts`, `src/app.css`) | Svelte **HMR** applies it in place. No reload, no lost state — the pages are served by the Vite dev server *through the extension's own origin*, so `chrome.*` is real | measured ~250-500ms |
| `src/background/**`, `src/content/**`, `manifest.config.ts`, `public/_locales/**` | Not hot-patchable. `dev:chrome` **relaunches the browser** and reopens both tabs | ~3s |

The second row is the interesting one, and the reason this script exists
rather than a bare `vite` call:

- CRXJS's own answer for a background/content edit is
  `chrome.runtime.reload()`. **That does not survive `--load-extension`** —
  measured on Chrome for Testing 152: the extension does not come back, every
  extension URL then fails with `ERR_BLOCKED_BY_CLIENT`, and the open panel
  tab is dropped onto `chrome://new-tab-page`. So `dev:chrome` sets
  `CRX_LIVE_RELOAD=false` (read by `crx()`'s `liveReload` option in
  `vite.config.ts`) and relaunches the browser itself.
- A relaunch alone still isn't enough. In dev mode the *registered* worker
  script is `service-worker-loader.js`, which statically imports the real
  `src/background/sw.ts` **from the Vite dev server**. A module service
  worker's imports are stored with its registration, and a persistent profile
  keeps that registration across a relaunch — so the worker happily goes on
  running the module it cached at install time while Vite serves the new one.
  `dev:chrome` deletes `<profile>/Default/Service Worker` before each launch,
  which is what makes a background edit actually land. Extension storage
  lives elsewhere (`Local Extension Settings`), so the seeded world survives.

Because the reload machinery is all CRXJS's dev path plus this script, there
is **no dev-only code in `src/`** and nothing to exclude from a production
build: `vite build` never runs any of it.

### Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--seed` | off | seed the profile from the shared typed fixtures (below). `npm run dev:seed` is this |
| `--port <n>` | `5176` | preferred Vite port; the first free port at or above it is used |
| `--profile <dir>` | `.chrome-dev-profile/` | the Chrome profile to reuse |
| `--no-demo` | off | don't start or open the demo server |

The profile is **persistent and gitignored**: providers you configure, MCP
servers you add, chats you have and the seeded data all survive a restart.
Delete `.chrome-dev-profile/` to get a genuinely fresh install back.

Two sessions at once work — the second one takes the next free port and gets
its own build directory (`dist-dev-<port>/`) automatically, but needs its own
`--profile` too, since Chrome will not share a profile between two running
browsers.

## Seeding

```
npm run dev:seed              # = npm run dev:chrome -- --seed
```

Seeding writes `src/infra/chrome-storage/testing/storage-fixtures.mjs` — the
**same fixture** `npm test` and the verify harness's screenshot matrix use —
straight into the launched profile's `chrome.storage`: six chats (one with a
full tool-call sequence including a denial and an error, one clean run), a
provider, a registered MCP server, both approval policies. See
[docs/05-testing.md](05-testing.md#the-fixture-both-layers-seed-from) for why
there is exactly one copy of that data.

Two details worth knowing:

- It **replaces** the fixture-owned keyspace (`chat:`, `tabchat:`) rather
  than adding to it, so re-seeding gives you the same world every time.
  Everything else in the profile is left alone.
- The panel tab `dev:chrome` opens is additionally stubbed (`chrome.tabs` and
  `runtime:get-tools`) so it looks at the fixture's `example.com` tab and its
  page tools — otherwise a panel opened as an ordinary tab correctly reports
  its own `chrome-extension://` tab as a restricted page and the seeded chat
  never shows. **The docked panel is never stubbed**: it sees the real active
  tab, plus the same seeded storage. Both stubs live in `verify/lib/seed.mjs`
  and are shared with the screenshot check.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev:chrome` | the loop above. `npm run dev:seed` seeds it |
| `npm run dev` | plain Vite dev server, no browser — you load `dist-dev/` yourself |
| `npm run build` | the real MV3 bundle into `dist/` |
| `npm run launch` | rebuilds and opens `dist/` in your real installed Chrome (one-time manual "Load unpacked") |
| `npm run demo` | the WebMCP fixture page on `:5175`, on its own |
| `npm run check` | `svelte-check` + `tsc`, no build output — typechecks the tests too |
| `npm test` | Vitest: domain, infra and component. `test:watch`, `test:coverage` |
| `npm run lint` / `format` | Biome, check-only. `lint:fix` / `format:check` |
| `npm run guard` | the six architecture guards — the pre-push gate |
| `npm run verify` | the Chrome-for-Testing harness. `-- --check <name>` runs one |
| `npm run verify:smoke` | the options-page form smoke (no model needed) |
| `npm run verify:smoke:live` | the live end-to-end turn against a local Ollama |
| `npm run compile:i18n` | Paraglide codegen (also runs on `postinstall`) |

## Running one test

Vitest takes a path substring, a name filter, and a project:

```bash
npx vitest run src/domain/chat/session.test.ts     # one file
npx vitest run src/domain/chat                     # one folder
npx vitest run -t "denies a mutating call"         # one test, by name
npx vitest run --project domain                    # the node-only layer
npx vitest run --project component                 # the jsdom layer
npx vitest src/domain/chat/session.test.ts         # …and watch it
```

The two projects and what belongs in each are
[docs/05-testing.md](05-testing.md).

## Running one verify check

The harness is ten checks in one browser session. While you are iterating on
one of them:

```bash
npm run verify -- --list                    # the names
npm run verify -- --check tool-discovery
npm run verify -- --check tool-call-error,tool-call-timeout
```

The report names every check and says explicitly which ones were skipped and
why (`not selected`), and skipped checks count as neither passed nor failed.

What `--check` does **not** skip: the build, the demo server, the browser
launch, or the navigation between checks — later checks depend on that shared
state. So one check still costs a browser; this is for iterating on a check,
not a faster gate.

### Tiers

| Tier | Command | Required? |
| --- | --- | --- |
| Required checks | `npm run verify` | **Yes** — part of the release gate |
| Screenshot matrix | same run, best-effort | No: reported `SKIP` (naming the missing shot) rather than failing |
| Options-form smoke | `npm run verify:smoke` | No — slower, UI-driven, needs no model |
| Live turn smoke | `npm run verify:smoke:live` | No — needs a local Ollama with a tool-capable model; exits 0 when Ollama isn't reachable |

The two smokes are deliberately **not** wired into `npm run verify`, `npm run
guard` or CI: one depends on a model being pulled locally, and neither is
something a required gate may assume.

## The guard suite

```
npm run guard
```

Six gates, each runnable alone (`npm run guard:biome`, `:boundaries`,
`:clean-code`, `:return-types`, `:throws`, `:i18n`). What each one fails on is
tabulated in the [README](../README.md#scripts); the architectural rules
behind `guard:boundaries` are in
[docs/01-architecture.md](01-architecture.md#the-guards).

Run `npm run guard` before pushing. It is check-only — it never rewrites your
tree — so a formatting failure means running `npm run format` yourself.

## Chrome for Testing vs real Chrome

| | `npm run dev:chrome` / `npm run verify` | `npm run launch` |
| --- | --- | --- |
| Browser | Chrome for Testing, downloaded on first run into gitignored `.chrome-for-testing/` | your installed Google Chrome |
| Loading the extension | automatic (`--load-extension`) | **one-time manual** "Load unpacked", then remembered for that profile |
| Profile | `.chrome-dev-profile/` (dev) or a temp dir (verify) | `.chrome-profile/` |
| Extension source | `dist-dev/` (live) | `dist/` (rebuilt on every launch) |

Branded Google Chrome **refuses** `--load-extension` outright — it logs
`--load-extension is not allowed in Google Chrome, ignoring.` and loads
nothing. That is a deliberate Chrome restriction with no command-line way
around it, which is why the automated paths use Chrome for Testing and
`npm run launch` asks you to click "Load unpacked" once.

Use `npm run launch` when the point is your real browser: your logins, your
extensions, real sites, a real local Ollama. Use `npm run dev:chrome` for
everything else.

### WebMCP has to be turned on

Nothing works without `document.modelContext`
([decisions/16](../decisions/16-native-webmcp-client.md)). Every launcher here
passes `--enable-features=WebMCP` for you. If a page still reports WebMCP
unavailable, turn the flag on by hand at
`chrome://flags/#enable-webmcp-testing` ("WebMCP for testing"; search
`webmcp` if that id has moved) and relaunch — full details and the
origin-trial alternative are in
[docs/02-webmcp-compatibility.md](02-webmcp-compatibility.md).

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| A UI edit doesn't show up | Look at the terminal: a Svelte or TypeScript error stops the update. Failing that, reload the panel tab — HMR gives up on some edits (renaming a module, changing `$state` shape) and says so in the page console |
| A background/content edit doesn't show up | It should relaunch the browser within a second of the save. If it didn't, check the path is under `src/background/`, `src/content/`, `public/_locales/` or is `manifest.config.ts` — anything else is treated as hot-patchable |
| Panel shows "restricted page" and none of the seeded chats | You are looking at the panel opened as a tab **without** `--seed`. Use `npm run dev:seed`, or click the toolbar icon to open the real panel against a real tab |
| `Could not launch Chrome for Testing … profile` | Another `dev:chrome` is already using `.chrome-dev-profile/`. Close it, or pass `--profile <dir>` |
| Everything is stale after switching branches | `rm -rf dist-dev .chrome-dev-profile` and start again — the profile is the only state that outlives a session |
| Chrome for Testing download fails on first run | It needs network access once. Install it yourself with `npx @puppeteer/browsers install chrome@stable --path .chrome-for-testing` |
| The demo page says WebMCP is unavailable | The `--enable-features=WebMCP` switch didn't take — see above |
| `npm run verify` can't find a display | MV3 extensions need a headed browser. On a headless machine run it under `xvfb-run` |

More user-facing failure modes (CORS against Ollama, provider setup) are in
[docs/04-troubleshooting.md](04-troubleshooting.md).

## CI

The same gates run in GitHub Actions on every push and pull request —
`.github/workflows/ci.yml`, per
[decisions/39](../decisions/39-ci-pipeline.md): a fast always-on job for
`check` / `test` / `guard` / `build`, and the Chrome-for-Testing harness on
its own job under `xvfb` with the screenshot matrix uploaded as an artifact.
Nothing in this document is CI-only: everything it runs is a script you can
run locally, which is the point.

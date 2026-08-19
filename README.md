# OpenChat (WebMCP)

A Chrome MV3 extension that puts a chat model in a side panel next to any tab
and lets it *drive that page* through [WebMCP](https://github.com/webmachinelearning/webmcp) —
tools a web page publishes on `navigator.modelContext`. The model reads and
acts on the page you're looking at, with your approval on anything that isn't
explicitly marked read-only.

It talks to either a local [Ollama](https://ollama.com) server or any
OpenAI-compatible Chat Completions endpoint (OpenAI itself, Azure OpenAI,
OpenRouter, LM Studio, etc.) — you register one or more providers in the
options page and pick a provider + model per tab. See
`decisions/12-branding-openchat-webmcp.md` for why the project is named this
way: "OpenChat" is the product, not tied to one backend; "(WebMCP)" names the
mechanism. The repository directory and git remote are intentionally left as
`ollama-webmcp-chrome` — renaming those is a separate, riskier operation left
to the user's discretion.

## What it does

- Injects a bridge into every page that discovers WebMCP tools regardless of
  whether the page has native browser support, ships a polyfill, or expects
  neither — see [docs/02-webmcp-compatibility.md](docs/02-webmcp-compatibility.md).
- Streams a chat conversation against your chosen provider, feeding it the
  page's tools and executing whatever it calls, subject to an approval policy.
- Keeps one conversation per browser tab, persisted across panel close/reopen.
- Adopts Chrome's own visual language rather than inventing a UI style, so the
  panel reads as part of the browser.

It does **not** phone home. There is no telemetry, no bundled backend, and no
account system — see [Privacy and trust](docs/03-privacy-and-trust.md).

## Requirements

- **Node.js** 20 or later, to build the extension. Not required at runtime.
- **Google Chrome 116+** (or a Chromium build of the same vintage) — this is
  the `minimum_chrome_version` in `manifest.config.ts`, set by the combination
  of the `chrome.sidePanel` API and `world: "MAIN"` content scripts.
- A chat backend: either a locally running [Ollama](https://ollama.com), or an
  API key for an OpenAI-compatible provider. Neither is required to build or
  load the extension — only to actually chat.

## Build and load it

```
npm install
npm run build
```

This produces `dist/`. **Load `dist/`, not the repository root** — the repo
root has no `manifest.json` at its top level and will not load.

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder produced by the
   build.
4. Click the extension's toolbar icon to open the side panel (it opens
   directly — there is no popup).

For iterative development, `npm run dev` runs Vite with HMR for the side
panel and options page; you still need to reload the unpacked extension in
`chrome://extensions` after most changes, since content scripts and the
service worker aren't hot-reloadable. `npm run check` runs `svelte-check`
plus `tsc` with no build output.

## Provider setup

Providers are registered in the extension's **options page** (right-click the
toolbar icon → *Options*, or open it from the side panel's picker when no
provider is registered). Each provider is `{ type, name, base URL, API key? }`.
The API key field only appears for provider types that use one. Adding a
provider that needs a host you haven't granted yet triggers a Chrome
permission prompt from the "Test connection" button — this has to happen from
a real click, which is why the button (not an automatic background check)
requests it.

### Ollama

1. Install and run [Ollama](https://ollama.com), then pull at least one
   tool-calling-capable model, e.g. `ollama pull qwen3` (any current model
   whose card advertises tool/function calling works — small/older/embedding
   models generally do not, and the picker will grey them out with a reason
   rather than hide them).
2. **Read [the CORS section below](#the-ollama-cors-trap-read-this-first)
   before you do anything else** — this is the single most common reason
   "it doesn't connect" reports happen on this project.
3. In the options page, add a provider of type Ollama. The default base URL
   is `http://localhost:11434`, which is already covered by the extension's
   baked-in `host_permissions` — no permission prompt needed for plain
   localhost/127.0.0.1.
4. Click **Test connection**. It calls the provider's own `listModels()` —
   the same code path used at chat time — so a green result means the picker
   will actually work.

### OpenAI-compatible

1. In the options page, add a provider of type OpenAI (or OpenAI-compatible),
   giving it a base URL (`https://api.openai.com` for OpenAI itself, or your
   Azure/OpenRouter/self-hosted endpoint) and an API key.
2. Any non-localhost host needs a runtime-granted host permission — clicking
   **Test connection** (or saving the provider) triggers Chrome's permission
   prompt for that origin the first time.
3. Tool-calling support isn't queryable from OpenAI's API, so the client
   ships a maintained allowlist of known tool-capable model IDs. A model not
   on that list shows as *"tool support not verified"* (disabled by default)
   rather than being silently trusted or hidden — see
   `decisions/11-provider-capability-detection.md`. If a new model isn't
   recognized yet, that's the allowlist being stale, not a bug report about
   your model.

API keys are stored **unencrypted** on this device and are deliberately kept
out of `chrome.storage.sync` so they never propagate to a second Chrome
profile signed into the same account — see
[Privacy and trust](docs/03-privacy-and-trust.md) and
`decisions/10-provider-registry-and-credential-storage.md`.

## The Ollama CORS trap (read this first)

By default, Ollama rejects requests whose `Origin` is `chrome-extension://…`.
Chrome's `fetch()` cannot distinguish "the server refused this origin" from
"there is no server at all" — both come back as a bare, generic network
failure. **This means a correctly-installed extension talking to a
correctly-running Ollama server looks exactly like a dead server**, and it is
easy to spend a long time checking the wrong things (is Ollama running? is
the port right? is the model pulled?) before realizing the actual cause.
This has bitten people working on this very project despite the failure mode
being documented in `decisions/04-ollama-transport.md` — don't assume it
won't happen to you.

**The fix:** set `OLLAMA_ORIGINS` to allow the extension, then restart the
Ollama server.

macOS / Linux, one-off:

```
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

If you run Ollama as a background service (macOS app, systemd, etc.) you need
to set the environment variable for that service specifically and restart it
— relaunching just the CLI in a new terminal without `OLLAMA_ORIGINS` set
will not pick it up. For systemd:

```
sudo systemctl edit ollama
```

```ini
[Service]
Environment="OLLAMA_ORIGINS=chrome-extension://*"
```

```
sudo systemctl restart ollama
```

For macOS, set it in your shell profile before Ollama.app is launched, or run
`launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"` and restart the app.

`chrome-extension://*` allows any installed extension's origin. If you want
to scope it to just this one, find the extension's id on `chrome://extensions`
(it's generated fresh per unpacked load, so it changes if you reload/rebuild
in a way that changes the key) and use
`OLLAMA_ORIGINS="chrome-extension://<that-id>"` instead.

If, after this, "Test connection" in the options page still fails, the
failure message names which of "unreachable" vs. "CORS-rejected" it actually
was where the client can tell (it usually can't, for the exact reason
above) — see [docs/04-troubleshooting.md](docs/04-troubleshooting.md).

## WebMCP demo pages

```
npm run demo
```

Serves two static fixture pages at `http://localhost:5175` (`index.html` and
`late.html`) with a handful of hand-built WebMCP tools — read-only, mutating,
destructive-hint, rich-schema, throwing, and hanging — for exercising the
extension without depending on a real third-party WebMCP site.
`late.html` deliberately assigns `navigator.modelContext` two seconds after
load (via a fake polyfill, not the real `@mcp-b/global` package) to exercise
the bridge's late-adoption path — see
[docs/01-architecture.md](docs/01-architecture.md). Load these pages in a tab
with the built extension installed and open the side panel to see tool
discovery happen live.

## Verification harness

```
npm run verify
```

Builds the extension into its own `dist-verify/` output (kept separate from
`dist/` so it can't be clobbered by a concurrent `npm run build`), launches
**real, headed Chromium** via Playwright with the extension loaded unpacked,
starts (or reuses) the demo server from `npm run demo`, and drives the actual
running extension: confirms the MAIN-world bridge really executes in the
page's JS world and is invisible to the ISOLATED-world relay, confirms tool
discovery against both demo pages including late adoption, confirms the
service worker's tool registry survives a real service-worker restart, and
calls tools end to end including the deliberately throwing and hanging ones.
It needs a graphical environment (MV3 extensions require a headed launch) and
Playwright's bundled Chromium (`npx playwright install chromium` if it hasn't
been downloaded yet). It does not require Ollama or any provider configured —
it only exercises the WebMCP bridge/relay/worker/demo path, not chat.

This is the only part of the project that has been checked against a real
running browser end to end; everything else in the codebase not covered by
`npm run verify` has so far only been verified structurally (`npm run check`,
`npm run build`, and reading emitted output) — see
`boards/project-backlog/25-in-browser-verification-harness.md`.

## Documentation

- [docs/01-architecture.md](docs/01-architecture.md) — the four JS contexts,
  how a tool call travels between them, the adopt-or-provide bridge shim, and
  the timeout ladder.
- [docs/02-webmcp-compatibility.md](docs/02-webmcp-compatibility.md) — what
  happens on native, polyfilled, and WebMCP-unaware pages, and what's
  explicitly out of scope (iframes).
- [docs/03-privacy-and-trust.md](docs/03-privacy-and-trust.md) — what's
  stored, where, unencrypted, and what a hostile page can and can't do to you
  through this extension.
- [docs/04-troubleshooting.md](docs/04-troubleshooting.md) — first-run
  failure modes and their actual fixes.

## Project status

This repository is organized as a [RepoDoc](.claude/skills/repodoc-workflow/SKILL.md)
project: `boards/project-backlog/` is the kanban board, `decisions/` records
why things are shaped the way they are, and this `docs/` tree is kept current
as behavior changes. A few things worth knowing if you're picking this up:

- **No in-app connection diagnostics yet.** `boards/project-backlog/14-connection-diagnostics-and-empty-states.md`
  (surfacing failures like "Ollama unreachable" or "no tool-capable models"
  as UI, with a concrete fix rather than a raw error) is still in the
  backlog. Today those failures surface as the error text the provider
  client itself returns — usable, but not the polished empty-state UI the
  card describes. [docs/04-troubleshooting.md](docs/04-troubleshooting.md)
  reflects only what exists right now and will need revisiting once card 14
  ships.
- **No tools/call-log inspector yet.** `boards/project-backlog/11-tools-and-call-log-inspector.md`
  (a second panel view listing every tool a page published and every call
  made) is also still in the backlog. The approval cards in the transcript
  are the only visibility into tool calls today.
- **Iframe tool discovery is deferred.** The bridge only injects into the top
  frame; tools published from an embedded widget or iframe are invisible to
  the extension. See `boards/project-backlog/18-iframe-tool-discovery.md` and
  `decisions/02-mainworld-webmcp-bridge.md`.
- **No Chrome Web Store listing.** Packaging and store submission
  (`boards/project-backlog/19-packaging-and-store-listing.md`) haven't
  happened; the only way to run this is loading `dist/` unpacked as above.

## License

No license file is present in this repository at the time of writing.

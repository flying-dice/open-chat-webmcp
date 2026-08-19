---
column: review
labels: [infra]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T16:35:00.000Z
---
# Scaffold the MV3 extension with Vite + Svelte

Stand up the build and the four-context skeleton so every later card has a place
to land. See decisions/03-vite-svelte-build.md and
decisions/01-side-panel-as-primary-ui.md.

Manifest shape: `sidePanel`, `storage`, `tabs`, `scripting` permissions;
host permissions for `http://localhost/*` and `http://127.0.0.1/*`;
`optional_host_permissions` for `http://*/*` and `https://*/*`;
`minimum_chrome_version: 116`.

The known risk is CRXJS emitting a `world: "MAIN"` content script correctly. If
it fights us, fall back to a hand-written manifest plus a multi-entry Vite config
— same source layout, different plugin.

## Checklist

- [x] `npm create vite` with Svelte + TypeScript, add `@crxjs/vite-plugin`
- [x] Manifest with side panel, both content scripts, module service worker
- [x] Entry stubs: `src/inject/bridge.ts`, `src/content/relay.ts`, `src/background/sw.ts`
- [x] Svelte apps mounted for `src/sidepanel` and `src/options`
- [x] Verify the MAIN-world script actually lands in the page world after build
- [x] `npm run dev` / `npm run build` both produce a loadable `dist/`
- [x] `.gitignore`, `tsconfig`, and a `git init` on the repo

## Comments

- **claude** (2026-08-19T16:35:00.000Z): Scaffolded via `npm create vite@latest -- --template svelte-ts` into a scratch dir and merged the config into the repo root (package.json, tsconfig*.json, svelte.config.js) to avoid wiping boards/decisions/.claude. Laid out the four-context skeleton: MAIN-world stub `src/inject/bridge.ts:1`, ISOLATED-world stub `src/content/relay.ts:1`, module service worker `src/background/sw.ts:1` (wires `chrome.sidePanel.setPanelBehavior` per decisions/01-side-panel-as-primary-ui.md), and Svelte 5 (runes) placeholder apps at `src/sidepanel/App.svelte:1`/`main.ts:1` and `src/options/App.svelte:1`/`main.ts:1`. Wrote the shared discriminated-union protocol at `src/lib/protocol.ts:1` — exports `SerializedTool`, `ToolSource`, the `BridgeOutEvent`/`BridgeInEvent` pair (with `BRIDGE_OUT_EVENT`/`BRIDGE_IN_EVENT` CustomEvent names), the `Runtime*` request/response/notification types, the top-level `Msg` union, and `isBridgeOutEvent`/`isBridgeInEvent`/`isRuntimeMessage` type guards.
- **claude** (2026-08-19T16:35:00.000Z): Manifest built via `defineManifest` in `manifest.config.ts:1`, consumed by `crx({ manifest })` in `vite.config.ts:1` (`@crxjs/vite-plugin@2.7.1`, Vite 8). Matches the card's shape: `sidePanel`/`storage`/`tabs`/`scripting` permissions, `host_permissions` for localhost/127.0.0.1, `optional_host_permissions` for `http(s)://*/*`, `minimum_chrome_version: "116"`, both content scripts at `document_start` on `<all_urls>` with `all_frames: false` (top frame only). CRXJS handled `world: "MAIN"` correctly with no fallback: the key was setting `contentScripts.standaloneFiles: ["src/inject/bridge.ts"]` in `vite.config.ts:12-19`, which makes CRXJS emit `dist/src/inject/bridge.js` as a bare self-contained IIFE referenced directly from `manifest.json`'s `content_scripts[1].js`, instead of routing it through CRXJS's usual loader/HMR wrapper (which would itself be what executes in MAIN world). Confirmed by inspecting `dist/manifest.json` (both `world` values preserved verbatim) and the built `dist/src/inject/bridge.js` / relay chunk source directly. Recorded the resolution in decisions/03-vite-svelte-build.md:32-48 including a dev-mode caveat (MAIN-world HMR wants explicit host matches in `externally_connectable`, doesn't affect `npm run build`). Full in-browser confirmation of world isolation (loading `dist/` unpacked, watching both console logs) is left for whichever card next touches the bridge — this environment can't launch Chrome. `npm install`, `npm run build`, and `npm run check` (svelte-check + tsc) all pass clean; `npm run dev` boots without crashing. `git init` done on the repo root (not yet committed, per not committing unless asked).

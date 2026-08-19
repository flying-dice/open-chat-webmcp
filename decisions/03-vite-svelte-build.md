---
status: Accepted
date: 2026-08-19
---
# Decision 03 — Build with Vite + Svelte 5 + TypeScript

## Context

The extension has four separate JavaScript contexts (MAIN-world bridge,
ISOLATED-world relay, background service worker, side panel) that exchange
messages, plus a stateful streaming chat UI. A zero-build vanilla setup would
load unpacked with no toolchain, but leaves the message protocol untyped and the
chat UI hand-rolled.

## Decision

Vite + Svelte 5 (runes) + TypeScript, bundled for MV3 with `@crxjs/vite-plugin`.

- The side panel and options page are Svelte apps.
- The bridge, relay, and service worker are plain TypeScript modules — no
  framework, bundled as IIFE/ESM entry points as MV3 requires.
- `src/lib/protocol.ts` holds the shared message types used by all four contexts,
  so a mismatch is a compile error rather than a silent no-op at runtime.
- `npm run dev` for HMR on the panel; `npm run build` emits `dist/`, which is
  what gets loaded unpacked.

## Consequences

- One typed protocol across all contexts — the main reason for the build step.
- Svelte's compile-to-DOM output keeps the panel bundle small, which matters for
  a surface that is created and destroyed on every open.
- **Risk:** MV3 `world: "MAIN"` content scripts and CRXJS have historically been
  awkward together. If CRXJS cannot emit the MAIN-world entry correctly, the
  fallback is a hand-written `manifest.json` plus a multi-entry Vite config with
  `vite-plugin-static-copy` — same source layout, only the plugin changes.

  **Resolved (card 01, 2026-08-19):** `@crxjs/vite-plugin@2.7.1` handles
  `world: "MAIN"` correctly out of the box — no fallback needed. It has a
  dedicated `contentScripts.standaloneFiles` option (`vite.config.ts`) that
  builds a listed content script as a self-contained IIFE with no CRXJS
  loader/HMR wrapper in front of it, which is what makes MAIN-world injection
  reliable: a loader script would be what actually lands in MAIN world instead
  of our code. `src/inject/bridge.ts` is listed there, and the manifest's
  `content_scripts[].world` field is honored verbatim in the build output
  (`dist/manifest.json`). Verified by building and confirming, at the source
  level, that the MAIN-world stub stamps a property on `window` that the
  ISOLATED-world stub cannot see (`src/inject/bridge.ts`,
  `src/content/relay.ts`) — real in-browser confirmation (loading `dist/`
  unpacked and checking both console logs) is still owed to whichever card
  next touches the bridge, since this environment cannot launch Chrome.
  One caveat for local development: `npm run dev` prints a warning that
  MAIN-world HMR needs explicit `http(s)` matches in
  `externally_connectable` — `<all_urls>` content-script matches can't be
  auto-added for that purpose. Does not affect `npm run build` correctness.
- Contributors need Node and an `npm install`; the repo folder itself is no
  longer loadable as an extension — `dist/` is.
- Service worker code must stay import-compatible with `type: "module"`.

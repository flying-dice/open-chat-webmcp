---
column: review
labels: [docs]
priority: med
agent: claude
live: false
updatedAt: 2026-08-19T21:15:00.000Z
---
# README and architecture docs

What this is, how to install it, how to configure Ollama, and how the four
contexts fit together.

Must state plainly that conversations — which can include page content and tool
results from authenticated sites — are stored unencrypted in
`chrome.storage.local` (decisions/07-session-state-and-persistence.md), and that
tool annotations are page-supplied UX guidance rather than a security boundary
(decisions/05-tool-approval-policy.md).

## Checklist

- [x] README: what it does, requirements, install unpacked from `dist/`
- [x] Ollama setup including the `OLLAMA_ORIGINS` requirement
- [x] `docs/` architecture page: bridge / relay / worker / panel and the message flow
- [x] WebMCP compatibility notes: native, polyfill, unsupported
- [x] Privacy and trust section
- [x] Troubleshooting mirroring the diagnostics from card 14

## Comments

- **claude** (2026-08-19T21:15:00.000Z): Wrote `README.md:1` and four docs pages. Read all of decisions/01-12 and every board card's `## Comments` journal (especially cards 02/03/04/25/26/28 for the bridge/relay/worker/panel chain, and card 27 for session ownership) before writing, per the card's instruction to describe what was actually built.
  README.md:1 covers what it does, requirements, `npm run build` + load-unpacked-from-`dist/` (README.md:44-58), provider setup for both Ollama and OpenAI-compatible (README.md:62-99), a dedicated "The Ollama CORS trap" section with the exact `OLLAMA_ORIGINS` fix for one-off/systemd/macOS (README.md:101-135), `npm run demo` (README.md:137-150), `npm run verify` (README.md:152-171), and a "Project status" section naming what's still backlog (card 14 diagnostics, card 11 inspector, card 18 iframes, card 19 store listing) so nothing undone reads as shipped.
  docs/01-architecture.md:1 draws the four-context flow (MAIN bridge / ISOLATED relay / service worker / side panel) as an ASCII diagram plus a call-by-call walkthrough, then documents the adopt-or-provide shim's late-adoption accessor-setter mechanism (citing src/inject/bridge.ts's `install()`/adopt/patchInPlace shape) and the four-rung timeout ladder as a table (bridge 20s / relay 25s / worker 30s / panel 35s, citing the actual constants in src/inject/bridge.ts, src/content/relay.ts, src/background/sw.ts, src/sidepanel/services/agentLoop.ts) with the real history of it breaking twice (cards 26, 28). Also documents the `panel.svelte.ts` sole-session-owner invariant and the card-27 bug that motivated it.
  docs/02-webmcp-compatibility.md:1 covers native/polyfilled(early+late)/unsupported(shim-provides) and explicitly scopes out iframes (card 18, deferred).
  docs/03-privacy-and-trust.md:1 states plainly, per the card's requirement: unencrypted conversation storage including tool results from authenticated sites (decisions/07), unencrypted API keys deliberately kept out of `chrome.storage.sync` (decisions/10), `readOnlyHint` as page-supplied UX guidance and not a security boundary with the real boundary named as "you opened the panel on this tab" (decisions/05), and no telemetry/backend.
  docs/04-troubleshooting.md:1 is scoped to what exists today only, per the task's instruction not to describe card 14's UI before it's built — it opens by saying explicitly that there's no diagnostics UI yet and that this page documents the underlying error-message mechanism, citing the actual error text in src/lib/ollama.ts and src/lib/providers/openai.ts.
  **Finding worth flagging**: the project is *not* currently branded "OpenChat (WebMCP)". decisions/12-branding-openchat-webmcp.md (Accepted) calls for that rename, but `manifest.config.ts:7`'s `name` field is still `"Ollama WebMCP"` and `package.json`'s `name`/`description` are still `ollama-webmcp-chrome`/Ollama-only — the rename cards (24, 26) are both still in `backlog`. I wrote the README/docs describing the extension's actual current name and added an explicit note in README.md pointing at decision 12 and card 26 as the pending, not-yet-applied rename, rather than documenting the aspirational name as if it were shipped.
  Did not touch anything under src/, boards/ (other than this card), decisions/, demo/, or verify/. `npm run check`/`npm run build` not re-run since no source changed.

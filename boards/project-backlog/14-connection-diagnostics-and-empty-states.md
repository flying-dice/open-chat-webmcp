---
column: review
labels: [frontend]
priority: med
agent: claude
live: false
updatedAt: 2026-08-19T18:10:00.000Z
---
# Connection diagnostics and empty states

Every way this can fail on first run, answered in the UI with the actual fix.
Most of these are configuration, not bugs, and a generic "network error" would
send people hunting in the wrong place.

The CORS case is the big one: a blocked preflight is indistinguishable from a
dead server in `fetch`, so the message must name `OLLAMA_ORIGINS` outright
(decisions/04-ollama-transport.md).

## Checklist

- [x] Ollama unreachable — how to start it, how to check the base URL
- [x] CORS blocked — set `OLLAMA_ORIGINS=chrome-extension://*` and restart, copyable
- [x] No models installed — suggest a concrete `ollama pull`
- [x] No tool-capable models — name a current tool-capable model to pull
- [x] Page publishes no WebMCP tools — explain, offer plain chat anyway
- [x] Restricted page (chrome://, Web Store, PDF) — say why it can't work there
- [x] Model stream errors mid-generation — keep the partial reply, allow retry

## Comments

- **claude** (2026-08-19T18:10:00.000Z): Widened the shared `ProviderError` vocabulary (src/lib/provider.ts:48-61) with an optional `fix: {label, command}` on `unreachable-or-cors`, populated for Ollama's CORS/unreachable case in src/lib/ollama.ts:81-102 with `OLLAMA_ORIGINS=chrome-extension://*` — additive, so src/options/lib/testResultDisplay.ts and testConnection.ts (untouched, out of scope) keep seeing only `.message` prose, unaffected. The panel renders `fix.command` as a fenced code block through the *existing* Markdown.svelte code-block pipeline (src/lib/markdown.ts's `renderCodeBlock`), which already ships a working Copy/Copied button — reused via a one-line `fenceOf()` helper in src/sidepanel/components/ProviderPicker.svelte:29-38 and src/sidepanel/services/agentLoop.ts's `noteForStreamError` (agentLoop.ts:150-166) rather than building a second copy-button implementation. Same fence trick also makes the "no models" and "no tool-capable models" `ollama pull llama3.1` suggestions copyable (ProviderPicker.svelte:216-227, 260-273).
- **claude** (2026-08-19T18:10:00.000Z): selection.svelte.ts's `ModelsState` error case now carries the full `ProviderError`, not just its prose (selection.svelte.ts:78-93, 260-280), so ProviderPicker branches on `.kind` the same way src/options/lib/testResultDisplay.ts already does for the options page — one shared vocabulary, not a second one invented for the panel. Auth (401) failures get an "Open options to check the API key" button both in the picker (ProviderPicker.svelte:180-182) and, if a chat call 401s mid-conversation, as an action chip on the transcript's error note (agentLoop.ts:167-173, panel.svelte.ts:19-35, Transcript.svelte:73-86).
- **claude** (2026-08-19T18:10:00.000Z): Mid-stream failures: agentLoop.ts's `runLoop` already left the partial assistant message untouched on a terminal error (endAssistantMessage runs first); it now also attaches a `"retry"` action chip to the follow-up error note (agentLoop.ts:106-115, 167-173) instead of just reporting failure. App.svelte tracks the last sent text (App.svelte:33-35) and `handleRetry` (App.svelte:99-103) resends it as a new turn — the failed turn's partial reply and error note both stay exactly where they streamed.
- **claude** (2026-08-19T18:10:00.000Z): Restricted pages (chrome://, chrome-extension://, the Web Store, the built-in PDF viewer): src/background/sw.ts's own detection (sw.ts:162-177) only ever surfaces as the result of an attempted tool call — `handleGetTools` reports a restricted tab identically to an ordinary zero-tool page (sw.ts:290-295), by its own comment's admission — and background/** was out of scope for this card. Reproduced the same enumeration client-side from the tab's URL in `restrictedPageReason` (src/sidepanel/services/activeTab.ts:41-95), wired into `pageInfo.restrictedReason` (panel.svelte.ts:113-124) and shown as a persistent banner above both the Chat and Tools & Log views (App.svelte:126-128, 156-166). Verified live: `npm run verify`'s side-panel screenshot opens the panel as its own `chrome-extension://` tab and the banner correctly reads "This is another extension's page..." (see verify/output/screenshots/sidepanel-light-320w.png). Flagged in the report: the PDF-viewer branch is a URL-suffix guess (`.pdf`), not authoritative like the scheme/host checks — sw.ts's relay-attempt detection is still the only 100%-accurate signal, but it isn't reachable from a passive tools listing without a background/protocol change outside this card's scope.
- **claude** (2026-08-19T18:10:00.000Z): "No WebMCP tools" in the chat view now gets its own brief, non-dead-ending note (App.svelte:16-29, Transcript.svelte:63-70) — "there's nothing extra to call here — plain chat works exactly the same" — deliberately shorter and differently worded than ToolsPanel.svelte's inspector-view explainer (untouched) so the two don't read as copy-pasted. Only one of the two (restricted vs. no-tools) note ever shows, to avoid the duplicate messaging an early draft had (caught via the verify screenshot, fixed).
- **claude** (2026-08-19T18:10:00.000Z): Gates: `npm run check` — 0 errors, 137 files. `npm run build` — green. `npm run verify` — 9/9 required checks passed, including the best-effort side-panel screenshot at 320px (light + dark).

## Gates

- [x] typecheck — npm run check: 0 errors, 137 files (claude, 2026-08-19T18:10:00.000Z)
- [x] build — npm run build: green (claude, 2026-08-19T18:10:00.000Z)
- [x] verify — npm run verify: 9/9 required checks passed (claude, 2026-08-19T18:10:00.000Z)

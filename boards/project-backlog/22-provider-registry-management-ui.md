---
column: review
labels: [frontend]
priority: high
live: false
agent: claude
updatedAt: 2026-08-19T16:10:00.000Z
---
# Provider registry management UI

Options-page UI to add, edit, remove, and reorder provider configs
(decisions/10-provider-registry-and-credential-storage.md): provider type, base URL,
optional API key, display name, set-as-default. Absorbs the provider-connection
portion of card 13's original scope.

Requesting a host permission for a provider's base URL goes through
`chrome.permissions.request` from a user gesture, generalizing the existing
localhost-only flow (decisions/09-provider-agnostic-chat-transport.md).

## Checklist

- [x] Provider list: add / edit / remove / reorder / set default
- [x] Provider type picker, base URL field, masked API key field, display name
- [x] "Test connection" — resolves via the provider's `listModels`/`getCapabilities`
- [x] Trigger `permissions.request` when a provider's base URL needs an ungranted host
- [x] Plain-language note that API keys are stored unencrypted locally
- [x] Empty state (no providers registered yet), distinct from the no-tool-models state

## Comments

- **claude** (2026-08-19T16:10:00.000Z): Built the full provider registry UI on top of the already-complete registry.ts (untouched). Wired `import "../lib/theme.css"` and `import "./options.css"` in src/options/main.ts:8-9 so the page finally consumes the Chrome-native tokens. Layout: src/options/App.svelte:9-27 mounts `<ProvidersSection />` and leaves an explicit comment marking where card 13's approval-policy/history section mounts as the next `<section class="section">` sibling inside the same `.page` flex column — shared shell classes (`.section`, `.section__header`, `.note`, `.badge`, `.empty-state`, etc.) live in src/options/options.css:1-30 for it to reuse.
  CRUD/reorder/set-default logic is in src/options/components/ProvidersSection.svelte (list state, permission-state map, refresh loop); add/edit form is src/options/components/ProviderForm.svelte (type picker, base URL, masked API key with show/hide toggle only shown for types that use one, optional default-model field, unencrypted-storage note at ProviderForm.svelte:209-212 and ProvidersSection.svelte:148-151); row rendering is src/options/components/ProviderRow.svelte.
  Test connection (src/options/lib/testConnection.ts) calls `createProviderClient(config).listModels()` — never a bespoke fetch — and maps every `ProviderError` kind to a distinct, worded outcome in src/options/lib/testConnection.ts:56-84, rendered via src/options/lib/testResultDisplay.ts. Auth failures name the fix ("check the API key"); `not-supported`/`unreachable-or-cors` pass the client's own message straight through — Ollama's already names the OLLAMA_ORIGINS fix (src/lib/ollama.ts:94), OpenAI's names the options-page permission grant (src/lib/providers/openai.ts:78-81) — so nothing here re-words or collapses them.
  Host permissions: src/options/lib/permissions.ts wraps `chrome.permissions.contains`/`.request` keyed off an origin-only match pattern derived from the base URL; localhost/127.0.0.1 read as already-granted for free since they're in `host_permissions`. Both ProviderForm and ProvidersSection call `chrome.permissions.request` as the first `await` inside their click-bound test handlers (ProviderForm.svelte:108-120, ProvidersSection.svelte:111-131) so the user gesture is never lost, and a declined/ungranted host renders its own "permission-denied" outcome distinct from a misconfigured-but-permitted provider — rows also show a live "Permission granted"/"Permission needed" badge (ProviderRow.svelte:67-76) kept in sync via `chrome.permissions.onAdded/onRemoved` listeners (ProvidersSection.svelte:57-65).
  Closed the coordinator-flagged wiring gap: src/options/main.ts:19-24 imports "../lib/providers/openai" for its self-registration side effect, so `createProviderClient` can construct an "openai" client — confirmed live via a throwaway Playwright harness (not committed) with a mocked chrome.* API: the OpenAI row/form selects, and clicking Test Connection against the real `https://api.openai.com` produced a genuine 401 rendered as "Authentication failed (401). Check that the API key entered for this provider is correct and hasn't expired," and against a bogus host produced the exact unreachable-or-cors message with its permission-grant fix. Left a note in main.ts:15-18 that the side panel (card 23) needs this same side-effect import in its own entry point — that bundle is separate and this import doesn't cover it.
  `npm run check` is 0 errors/0 warnings and `npm run build` is green. Verified light and dark rendering, the add/edit forms, and the empty state via the same throwaway Playwright harness; all screenshots and the harness file were deleted afterward, nothing added to the repo.
  Found in passing, not mine to fix: a `npm run check` run at the very end (after my own files were done) turned up 1 error in src/sidepanel/stores/selection.svelte.ts:135 (`SelectionResolution` missing `.model` on the `{status:"none"}` branch) — that's concurrent work in a file I don't own, unrelated to anything touched here.

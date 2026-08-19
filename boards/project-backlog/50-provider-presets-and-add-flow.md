---
column: review
labels: [frontend, backend]
priority: high
agent: sonnet
updatedAt: 2026-08-20T10:40:00.000Z
---
# Predefined backend presets and a "pick a backend" add flow

Adding a provider currently asks for a base URL, type, name, key and headers —
the right floor, a poor front door. Every hosted backend is the same three facts
(base URL, auth shape, where to get a key) and the user supplies all three from
memory.

See [decisions/21](../../decisions/21-provider-presets.md).

## Scope

**New `src/lib/providers/presets.ts`** — static data only, no behaviour:

```ts
interface ProviderPreset {
  id: string; label: string; type: ProviderType; baseUrl: string;
  requiresKey: boolean; local: boolean; docsUrl: string; note?: string;
}
```

Catalog: Ollama, LM Studio, llama.cpp (local, no key); OpenAI, Anthropic, Google
Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together; plus Custom
(OpenAI-compatible). Azure OpenAI is deliberately out — see decisions/21.

**Verify every base URL against the provider's current documentation before
committing it.** These move, and a wrong one produces a confusing
`unreachable-or-cors` failure that looks like a user mistake. Do not copy them
from memory or from this card without checking.

**`ProviderConfig` gains `presetId?: string`** (`src/lib/providers/registry.ts`).
Absence means Custom — that is a valid state for every already-stored provider,
so do NOT write a migration.

**Options add-flow** (`ProviderForm.svelte`, `ProvidersSection.svelte`,
`ProviderRow.svelte`): choosing a backend first, then a form pre-filled from the
preset showing only what that backend needs — usually just the key. Local presets
ask for no key at all. Every field stays editable; a preset is a starting point,
not a constraint. `ProviderRow` labels a provider by its backend.

Keep the existing host-permission request on save (decision 10) exactly as it
is — a preset does not grant permission, and `requestHostPermission` still needs
its user gesture.

Reuse what card 41 built: `src/lib/providers/capability.ts` for the
tool-capability rule and the "Set as default" guard, and the existing
`mcpTestConnection`-style test-connection affordance if one fits. Do not add a
second copy of either.

## Checklist

- [x] `presets.ts` catalog, every base URL verified against current docs
- [x] `presetId` on `ProviderConfig`; absence treated as Custom, no migration
- [x] Add flow: pick backend, then a form asking only for what it needs
- [x] Local presets ask for no key; hosted ones link to where to get one
- [x] Every prefilled field still editable
- [x] `ProviderRow` shows which backend a provider is
- [x] Existing stored providers still load, edit and save unchanged

## Comments

- **sonnet** (2026-08-20T09:05:00.000Z): Claimed the card. Read decisions/21, 10, 09, 15 and the current registry/form/permissions code before touching anything. Key finding while reading `src/lib/providers/openai.ts:49-56,209,525`: the OpenAI-compatible client treats `config.baseUrl` as HOST-ONLY and always appends its own `/v1/models` or `/v1/chat/completions` — it does NOT match the convention most provider docs quote for the OpenAI SDK's `base_url` (which usually already ends in `/v1` or similar, with only `/chat/completions` appended by the SDK). So every hosted preset's base URL has to be doc's-base-url-with-the-trailing-`/v1`-segment-stripped, not a literal copy of what the docs show. Verifying each one for real (WebFetch against current docs, then curl against the live API to confirm the resulting `<baseUrl>/v1/models` path hits a real auth handler, not a 404) before writing `presets.ts`.
- **sonnet** (2026-08-20T09:45:00.000Z): Verified all 12 base URLs. Method: WebFetch against each provider's current docs page for the "official" `base_url`, then a real `curl` against `<my-baseUrl>/v1/models` with a fake bearer token to confirm the response is that provider's genuine auth-error JSON (not a 404) — proof the request actually reached the real handler, not just that the docs said so. Two non-obvious findings worth recording: (1) Google Gemini's OpenAI-compat endpoint is documented at `.../v1beta/openai/chat/completions` with no extra `/v1` segment, yet `curl` confirms Google's gateway also accepts `.../v1beta/openai/v1/chat/completions` (identical `"Please pass a valid API key"` body on both, vs. a genuine 404 for an unrelated bogus path) — so `baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai"` works correctly through this client's fixed `/v1/...` suffix. (2) DeepSeek's API accepts both `/models` and `/v1/models` (confirmed identical auth-error body on both), so the plain host `https://api.deepseek.com` is safe. Every other hosted preset is the doc's quoted `base_url` with its trailing `/v1` (or `/openai/v1`) segment stripped off, e.g. Groq's documented `https://api.groq.com/openai/v1` becomes `baseUrl: "https://api.groq.com/openai"`. Wrote the catalog to src/lib/providers/presets.ts:1-197 (`PROVIDER_PRESETS`, `getPreset`) with each preset's `docsUrl`/`note` and this reasoning in the module doc comment.
- **sonnet** (2026-08-20T10:10:00.000Z): Added `presetId?: string` to `ProviderConfig` (src/lib/providers/registry.ts:39-50) and accepted it as an optional string in `isStoredProviderConfig` (registry.ts:73-76). `addProvider`/`updateProvider` needed no other changes — both already spread `rest`/`patch` through unmodified, so `presetId` flows to `chrome.storage.sync` for free. No migration written; a stored config with no `presetId` is unaffected and reads exactly as before.
- **sonnet** (2026-08-20T10:20:00.000Z): Built the add-flow. New `src/options/components/PresetPicker.svelte` renders the "choose a backend" grid (Local group, Hosted group, plus a dashed "Custom (OpenAI-compatible)" tile that hands back `undefined`). `ProvidersSection.svelte:59-66,156-161,336-354` replaced the old boolean `adding` with a 3-state `addStep: "closed"|"choose"|"form"` plus `chosenPreset`, so "+ Add provider" opens the picker first and only then mounts `ProviderForm` pre-filled from the choice. `ProviderForm.svelte` gained a `preset` prop, `activePreset` (the add-mode prop or, in edit mode, `getPreset(initial?.presetId)`), a `showApiKeyField` derived (ProviderForm.svelte:180-184) that hides the key field by default for `activePreset.local` presets unless a key is already set or the user clicks the new "Add one anyway" escape hatch (ProviderForm.svelte:382-389) — nothing is ever permanently hidden, satisfying "every field stays editable." Added the preset's `note` callout and a "Get an API key" link to `activePreset.docsUrl` next to the key field (ProviderForm.svelte:374-380). `buildData()` now submits `presetId` (add mode: the chosen preset's id; edit mode: resubmits `initial.presetId` unchanged). `ProviderRow.svelte` now derives `backendLabel` via `getPreset(provider.presetId)?.label ?? TYPE_LABELS[...]` (ProviderRow.svelte:73-83) so a row reads "Groq" instead of "OpenAI-compatible". Added `.preset-banner`/`.preset-picker__*`/`.preset-tile*` classes to src/options/options.css:307-360, reusing existing tokens only, no new colours.
- **sonnet** (2026-08-20T10:35:00.000Z): Verified for real, not just by reading code. `npm run check`: 0 errors. `npm run build`: clean. `npm run verify`: 9/9 (one transient `ERR_CONNECTION_REFUSED` on the WebMCP-unavailable check on a first run, almost certainly the demo server on shared port 5175 getting stopped by a concurrent `verify` run in a sibling worktree — a clean rerun passed 9/9, and that check is unrelated to anything touched here). Then drove the actual built extension in Chrome for Testing via `verify/lib/browser.mjs` + Playwright against the real options page (throwaway scripts, not committed): confirmed the picker lists all 12 presets + Custom; Groq prefills name/baseUrl (`https://api.groq.com/openai`), shows the key field with a working `console.groq.com/keys` link; Ollama prefills `http://localhost:11434`, type `ollama`, no key field; LM Studio prefills `http://localhost:1234`, key field hidden by default and revealed by "Add one anyway"; Custom opens today's blank form with no preset banner; saving a Groq-preset provider shows a "Groq" row badge that survives a page reload; a hand-seeded legacy provider with no `presetId` (simulating everything stored before this card) loads, shows "OpenAI-compatible" as before, and edits/saves cleanly; editing the saved Groq provider still shows its key field and docs link and keeps the "Groq" badge after save + reload. Card done — moving to review.

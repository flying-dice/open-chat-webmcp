---
column: review
labels: [frontend]
priority: med
agent: sonnet
live: false
updatedAt: 2026-08-20T00:35:00.000Z
---
# Pick the default model from the known list, not free text

Remove `ProviderConfig.defaultModel` (the options page's "Default model
(optional)" text field) and the manual-typing workflow it powers. See
decisions/23-default-model-from-known-list-not-free-text.md.

"Set as default" should instead load that provider's actual model list — the
same path the side panel's picker uses (`client.listModels()` + capability
resolution) — and offer only tool-capable models in a dropdown. A provider
that can't list models (`ProviderError.kind === "not-supported"`) has no
dropdown; its row explains that picking a model for it once in the side
panel seeds the default automatically (the composer's existing seed-once
behavior in `src/sidepanel/stores/selection.svelte.ts`'s `selectModel`,
untouched by this card).

The reusable, capability-resolving half of the side panel's per-provider
model-loading logic (`resolveCapabilities`,
`src/sidepanel/stores/selection.svelte.ts`) should move into the already-shared
`src/lib/providers/capability.ts` so the options page reuses it instead of
hand-rolling a second copy.

## Checklist

- [x] `ProviderConfig.defaultModel` and its validator check removed from `src/lib/providers/registry.ts`
- [x] `resolveCapabilities` extracted from `src/sidepanel/stores/selection.svelte.ts` into `src/lib/providers/capability.ts` as a shared export; `selection.svelte.ts` imports it instead of defining its own copy (no behavior change there)
- [x] `src/options/components/ProviderForm.svelte`'s "Default model (optional)" field, its state var, and its `buildData()` entry removed
- [x] `src/options/components/ProvidersSection.svelte` loads each provider's model list (parallel, degrading per provider — decisions/22's discipline) instead of checking a single free-text string, and drives "Set as default" off a chosen model from that list
- [x] `src/options/components/ProviderRow.svelte`'s "Set as default" becomes a `<select>` of that provider's tool-capable models + button, with a clear reason shown when blocked (loading / not-supported / no tool-capable models)
- [x] The "Default" badge (read-only, showing which provider currently holds the stored default) and the stale-default warning banner (card 41) are unchanged
- [x] `npm run check`, `npm run build`, `npm run verify` all green
- [x] Manually verified in the built options page: setting a default via the new dropdown, a not-supported provider's disabled state and hint text, and the existing stale-default banner still firing correctly

## Gates

- [x] check — svelte-check + tsc: 170 files, 0 errors, 0 warnings (sonnet, 2026-08-20T00:20:00.000Z)
- [x] build — `npm run build` green (sonnet, 2026-08-20T00:21:00.000Z)
- [x] verify — `npm run verify` 9/9 required checks passed (sonnet, 2026-08-20T00:24:00.000Z)

## Comments

- **sonnet** (2026-08-20T00:00:00.000Z): Claimed the card. Read decisions/23, card 41 (the capability-check machinery this builds on), `src/lib/providers/registry.ts`, `src/lib/providers/capability.ts`, `src/sidepanel/stores/selection.svelte.ts` (the `ModelsState`/`ModelListEntry`/`loadModelsForProvider`/`resolveCapabilities` pattern to mirror), and the three options-page files to change (`ProviderForm.svelte`, `ProvidersSection.svelte`, `ProviderRow.svelte`). Plan: (1) drop `defaultModel` from `ProviderConfig` + its validator; (2) move `resolveCapabilities` into `capability.ts` as a shared export, `selection.svelte.ts` imports it; (3) strip the free-text field from `ProviderForm.svelte`; (4) give `ProvidersSection.svelte` a real per-provider `ModelsState`-shaped load keyed by provider id, replacing `defaultModelChecks`; (5) `ProviderRow.svelte` gets a `<select>` of tool-capable models + local `$state` for the chosen id, defaulted/reset on provider or list change. Starting implementation now.
- **sonnet** (2026-08-20T00:30:00.000Z): Implemented all five pieces. `src/lib/providers/registry.ts:47,85` — dropped `defaultModel?: string` from `ProviderConfig` and its validator clause. `src/lib/providers/capability.ts:44-59` — new exported `resolveCapabilities(client, models)`, the body lifted verbatim from the side panel's private copy. `src/sidepanel/stores/selection.svelte.ts:72,311-317(removed)` — imports the shared one instead, pure refactor (no other line in that file changed). `src/options/components/ProviderForm.svelte:97-98,229-243,452-460(removed)` — the `defaultModel` state var, its `buildData()` entry, and the whole "Default model (optional)" field markup are gone. `src/options/components/ProvidersSection.svelte:39-63` — new `DefaultModelOptionsState` union (`loading` / `loaded` with pre-filtered tool-capable `options` / `error` / `not-supported`) keyed by provider id in `defaultModelOptionsState`, loaded per-provider via `loadDefaultModelOptions` (`:106-151`, token-guarded exactly like `selection.svelte.ts`'s `loadModelsForProvider`) and `refreshDefaultModelOptions` (`:154-156`, fired in parallel from `refresh()` at `:198`). `canSetDefault`/`setDefaultBlockedReason` replaced by `defaultModelsLoading`/`defaultModelOptionsFor`/`setDefaultBlockedReason` (`:253-283`) — not-supported points at the side panel's seed-once behavior, loaded-with-zero gets "No tool-capable models found on this provider.", loading reports no reason yet. `handleSetDefault` (`:296-303`) now takes `(provider, modelId)` and re-validates `modelId` against the CURRENT `defaultModelOptionsState` before writing (defense-in-depth, same pattern as `selectModel`). `src/options/components/ProviderRow.svelte:19-90` — `checkingDefaultModel`/`canSetDefault` props replaced by `defaultModelsLoading`/`defaultModelOptions`/`defaultModelBlockedReason`; new local `selectedModelId` `$state`, defaulted to the first tool-capable model and reset via `$effect` whenever the options list changes (provider identity changes already remount the component — it's keyed by `provider.id` in the parent's `{#each}`). Template (`:157-178`) renders a `<select>` + button only when `defaultModelOptions.length > 0`, a disabled "Checking…" button while loading, and falls back to the existing muted `.hint` treatment otherwise — "Default" badge and `defaultInvalidReason` badge untouched. Gates: `npm run check` 170 files/0 errors, `npm run build` green, `npm run verify` 9/9 — all recorded under `## Gates`.
- **sonnet** (2026-08-20T00:35:00.000Z): Manually verified in a real built options page. Reused card 41's approach (`verify/lib/browser.mjs`'s `launchExtension()` against `dist-verify/`, driven with Playwright) via a throwaway script under the scratchpad dir. Ran two tiny local HTTP servers on `127.0.0.1` (covered by the manifest's mandatory `http://127.0.0.1/*` host permission, so no runtime grant needed): one serving `/v1/models` with a mixed list (`gpt-4o` tool-capable, `custom-unverified-model` unknown, `gpt-3.5-turbo-0301` no-tools) and one 404ing it to force `not-supported`. Seeded `providers:list`/`providers:default` directly via `chrome.storage.sync` (a third provider held a pre-seeded stale default so the two rows under test weren't themselves masked by `isDefault`), reloaded the options page, and asserted: the "Mixed Capability" row's dropdown offered exactly `["gpt-4o"]` (the no-tools/unknown models never appear); the "No Listing API" row rendered no `<select>` at all and its `.hint` text read "This provider can't list its models. Pick a model for it once in the side panel instead — that seeds the default automatically."; the `.note--warning` stale-default banner was present at load ("Confirmed not to support tool calling."); clicking "Set as default" on the Mixed Capability row actually wrote `{providerId: "mixed-provider", model: "gpt-4o"}` to `chrome.storage.sync`'s `providers:default`, flipped its badge to plain "Default", and made the stale banner disappear; and the only console message logged was Chrome's own network-log line for the intentional 404 from the not-supported fixture server, no real page/JS errors. All checks passed. Moving to review.

---
column: review
labels: [frontend]
priority: high
agent: sonnet
live: false
updatedAt: 2026-08-20T10:40:00.000Z
---
# Flatten the composer's model picker into one grouped list

Decision 18 moved the picker into the composer's action row, which is right and
stays. The interaction did not follow: it is still card 23's two-level control —
a provider `<select>`, then that provider's models. Switching from a local model
to a hosted one is two decisions, and nothing shows what is available at once.

Target is the Gemini / VS Code Chat model: one list, provider as context rather
than a gate.

See [decisions/22](../../decisions/22-flat-model-picker.md).

## Scope

`src/sidepanel/components/ProviderPicker.svelte` and
`src/sidepanel/stores/selection.svelte.ts`.

**The chip** shows the current model id alone, truncated, with a chevron. Not
"provider / model" — the provider belongs in the list.

**The list**, in this order:

1. Selectable models, grouped under a per-provider heading. A provider with no
   selectable models contributes no heading.
2. "Unverified" — `unknown` capability, selectable, with the existing inline
   reason. Rows carry their provider as secondary text.
3. "No tool support" — `no-tools`, disabled, with its reason. Never hidden;
   decision 06 requires a model be shown and explained rather than omitted.

**Filter input** at the top, appearing only once the total row count passes a
small threshold — a filter box over four models is noise. Matches model id and
provider name.

**"Manage providers…"** pinned at the bottom, opening the options page. That is
the picker's only configuration affordance; adding and editing providers stays
in options.

**The real work is in the store, not the markup.** `selection.svelte.ts`
currently loads models for the *browsed* provider only. It now needs every
configured provider's models, loaded in parallel and degrading per provider: one
unreachable backend greys its own group and must never block or fail the others.
This is the same discipline decisions/19 §4 applies to MCP server discovery —
read how `src/sidepanel/services/mcpTools.ts` does it and follow that shape.

Losing the provider `<select>` removes the only place a provider's connection
error was stated prominently. Surface it on that provider's group heading or it
disappears — check what `selection.modelsState`'s `error` branches currently
render (`unreachable-or-cors` with its `fix` copy, `auth`, `not-supported`,
manual-entry fallback) and make sure each still has a home. The manual-model-entry
path for backends with no `/v1/models` must survive too.

Capability state comes from `src/lib/providers/capability.ts` (card 41's shared
module) so the picker and options page cannot drift.

Selection stays per-tab and persisted exactly as today (decision 07, card 35's
explicit-selection rule). Presentation changes; what a selection means does not.

Match decisions/18's design system — compose `Icon`/`IconButton`/`Tooltip` and
the existing sheet/popover patterns rather than hand-rolling markup.

## Checklist

- [x] Chip shows the model id alone, truncated, with a chevron
- [x] One list: per-provider groups, then Unverified, then No tool support
- [x] Disabled rows keep their inline reason and sort to the bottom
- [x] Filter appears only past a threshold; matches model id and provider
- [x] All providers' models load in parallel, degrading per provider
- [x] Per-provider connection errors surface on the group heading
- [x] Manual-model-entry path still reachable
- [x] "Manage providers…" opens options
- [x] Keyboard: filter, arrow, enter, escape; click-outside still closes

## Gates

No script/field gates are configured on this board's columns
(`boards/project-backlog/.config.json`'s `doing`/`review` columns carry
neither `enter` nor `exit` gates) — bars below are recorded here as evidence
for a human reviewer, not because a gate required them.

- [x] npm run check — 167 files, 0 errors, 0 warnings (sonnet, 2026-08-20T10:35:00.000Z)
- [x] npm run build — vite build succeeds, no warnings (sonnet, 2026-08-20T10:35:00.000Z)
- [x] npm run verify — 9/9 required checks passed, including the best-effort side-panel screenshot check (sonnet, 2026-08-20T10:36:00.000Z)

## Comments

- **sonnet** (2026-08-20T09:15:00.000Z): Claimed. Read decisions/22, 18, 11, 06, 07, plus `src/sidepanel/components/ProviderPicker.svelte`, `src/sidepanel/stores/selection.svelte.ts`, `src/sidepanel/components/Composer.svelte`, `src/lib/providers/capability.ts`, and `src/sidepanel/services/mcpTools.ts` for its degrade-per-source discovery shape. Inventoried every state the old two-level UI had to keep a home for: `unreachable-or-cors` (+ copyable `fix`), `auth`, `not-supported` + manual entry, dangling-selection, zero-providers, and Ollama's zero-models `ollama pull` hint.
- **sonnet** (2026-08-20T09:45:00.000Z): Rewrote `src/sidepanel/stores/selection.svelte.ts`. Replaced the single "browsed provider" concept (`browsingProviderId`, `selectProvider`, one global `modelsState`) with `providerModelsState: Record<providerId, ModelsState>` (src/sidepanel/stores/selection.svelte.ts:130) exposed as `selection.modelsByProvider`. `loadModelsForProvider` (src/sidepanel/stores/selection.svelte.ts:332) is the per-provider unit of work — fired without awaiting siblings from `ensureModelsLoaded` (src/sidepanel/stores/selection.svelte.ts:214) and `refresh` (src/sidepanel/stores/selection.svelte.ts:492), so each provider's slot in `providerModelsState` updates the moment ITS OWN `listModels()`/capability resolution settles, independent of how long any other provider takes. Deliberately used a PER-PROVIDER token map (`providerTokens`, src/sidepanel/stores/selection.svelte.ts:333) rather than mcpTools.ts's single shared refresh token — a shared token would mean retrying one slow/broken provider silently discards an in-flight load for a provider that was never asked to reload, which is exactly the "one backend blocks/fails the others" failure this card is about avoiding. `selectModel`/`enterManualModel`/`reloadModels` all gained an explicit `providerId` parameter now that there's no implicit "browsed" one.
- **sonnet** (2026-08-20T10:05:00.000Z): Rewrote `src/sidepanel/components/ProviderPicker.svelte` as the flat, grouped list. Per-provider groups (`groups`/`visibleGroups`, src/sidepanel/components/ProviderPicker.svelte:203-259) each carry the provider's raw `ModelsState` alongside its selectable rows — a provider contributes a heading if it has selectable models OR is in a state worth surfacing on its own (loading/error/not-supported/loaded-with-nothing); a provider that loaded fine with models but none tool-capable is the one case that's silently folded into Unverified/No-tool-support instead, per decision 22's literal "no selectable models, no heading." `bucketOf` (src/sidepanel/components/ProviderPicker.svelte:182) partitions every row into selectable/unverified/no-tools via `capability.ts`'s `isSelectable`, never reimplementing the rule. Rows in the last two groups carry `showProvider=true` in the shared `modelRow` snippet so they show their provider as secondary text (decision 22).
- **sonnet** (2026-08-20T10:10:00.000Z): Mapped every old state to its new home: `unreachable-or-cors` + copyable `fix` and `auth` now render under that PROVIDER'S OWN group heading (ProviderPicker.svelte:405-419) instead of a single global banner — this is the fix for decision 22's called-out regression risk ("losing the provider `<select>` removes the only place a connection error was stated prominently"). `not-supported` keeps its manual-entry form under the provider's heading (ProviderPicker.svelte:420-437); a resolved manual entry that's selectable shows in that provider's own selectable list above the form (no separate rendering needed — it's just part of `allRows`), a non-selectable one renders once, directly below the form, guarded against double-rendering. Ollama's zero-models state keeps its `ollama pull llama3.1` hint verbatim (ProviderPicker.svelte:438-448) under that provider's heading. The old "no tool-capable models on this provider, pull one" banner doesn't have a literal home per-provider anymore (decision 22 forbids a heading there) — instead the `ollama pull` hint moved to sit under the shared "No tool support" SECTION heading whenever any row in it belongs to an Ollama provider (`noToolsHasOllama`, ProviderPicker.svelte:266-267), so the concrete command survives without violating the "no heading for a provider with no selectable models" rule. Dangling-selection keeps its warning banner at the top of the sheet, now feeding straight into the flat list instead of a browse-then-pick flow. Zero-providers empty state is untouched.
- **sonnet** (2026-08-20T10:20:00.000Z): Filter (ProviderPicker.svelte:230-245) appears only once total row count exceeds `FILTER_THRESHOLD = 8`, matches model id OR provider name (also gating whether a status-only heading with no rows survives a query). Keyboard: filter box supports ArrowDown (jump to first enabled row) and Enter (pick the top match, mirroring Gemini/VS Code Chat's own shortcut) at ProviderPicker.svelte:302-311; rows use a roving `ArrowUp`/`ArrowDown` over `.model-row:not(:disabled)` (ProviderPicker.svelte:289-300), `ArrowUp` from the first row returns focus to the filter box. Escape/click-outside are unchanged from card 23 (still a window-level listener gated on `selection.pickerOpen`). Sheet auto-focuses the filter box (or the first row when there's no filter) on open via a `tick()`-gated effect.
- **sonnet** (2026-08-20T10:30:00.000Z): `npm run check` (0 errors/warnings) and `npm run build` both pass. `npm run verify` is 9/9, including the best-effort side-panel screenshot check — `.picker__trigger` (the selector `verify/checks/screenshots.mjs` clicks to capture `sidepanel-dark-model-sheet.png`) still resolves; that shot now shows the flat grouped list instead of the old two-level sheet, chip prints the model id alone. Beyond the harness's own screenshots, drove the real built extension with a throwaway Playwright script (scratchpad, not committed) seeding 6 mocked providers via `page.route` to force every state at once: an Ollama provider with a 3-selectable/2-no-tools mix (incl. the active-selection checkmark), a 403 origin-rejection (`unreachable-or-cors` + its exact copyable `OLLAMA_ORIGINS` fix command), an empty Ollama provider (`ollama pull` hint), an OpenAI 401 (auth banner + "Open options"), an OpenAI 404 (not-supported + manual entry — verified both a tool-capable AND a confirmed-no-tools manually-entered id render correctly, no duplicates), and a mixed OpenAI provider (allowlisted/no-tools/unlisted → Unverified). Also verified: filtering by "gpt" correctly narrows to matching provider names and model ids; ArrowDown from the filter box focuses a `.model-row`; Escape and click-outside both close the sheet; picking a row closes the sheet and updates the chip to the model id alone; a dangling selection (`providerId` not in the registry) shows the "provider removed" banner and lets you pick a replacement from the same flat list; zero registered providers still shows the original empty state. All screenshots matched expectations. Ready for review.

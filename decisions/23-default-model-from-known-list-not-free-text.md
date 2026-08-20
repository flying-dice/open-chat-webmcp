---
status: Accepted
date: 2026-08-20
---
# Decision 23 — Pick the default model from the known list, not free text

## Context

The options page's provider registry has a "Default model (optional)" text
field (`ProviderConfig.defaultModel`, `src/lib/providers/registry.ts`) that
exists only to power the "Set as default" button: the user blind-types a
model id, and clicking "Set as default" writes `{providerId, model}` as the
app-wide default selection (`chrome.storage.sync`'s `providers:default`).

Decisions/11 and card 41
(`boards/project-backlog/41-set-as-default-ignores-tool-capability.md`)
already established that the side panel's picker never lets a user select a
model without knowing its tool-capability, resolved from the provider's
actual, loaded model list. Card 41 added a capability check on top of the
free-text `defaultModel` value, but the field itself is still "type a model
name and hope it's right" — the one model-picking surface in the app that
isn't backed by a real, loaded list.

## Decision

`ProviderConfig.defaultModel` is removed. "Set as default" on the options
page now loads that provider's model list — the same path
(`client.listModels()` + capability resolution) the side panel's picker uses
— and offers only tool-capable models in a dropdown. A provider whose
backend can't list models (`ProviderError.kind === "not-supported"`) has no
dropdown and no "Set as default"; its row explains that picking a model for
it once in the side panel seeds the default automatically (the composer's
existing seed-once behavior in `src/sidepanel/stores/selection.svelte.ts`'s
`selectModel`, unchanged by this decision).

The capability-resolving part of the side panel's per-provider model-loading
logic (`resolveCapabilities`) moves into the already-shared
`src/lib/providers/capability.ts`, so the options page and the side panel
both call the one copy instead of the options page hand-rolling a second one
— the same "single copy both surfaces import" ethos that file's own header
comment (written for card 41) already commits to.

## Consequences

- The options page duplicates a small slice of the side panel's per-provider
  model-loading shape (a `ModelsState`-like union, loaded per provider,
  degrading independently per decisions/22) — acceptable, since the two
  surfaces have different UI needs around it (a dropdown vs. a flat grouped
  picker) and the actual capability-resolution logic is shared, not
  duplicated.
- Card 41's stale-default detection (`refreshStaleDefault`/
  `staleDefaultReason`) stays exactly as it is — still the right check for
  "the stored default no longer resolves," regardless of whether the default
  was set via this dropdown or seeded from the side panel.
- A provider with a `not-supported` model-listing API loses the ability to be
  set as the default from the options page at all (previously it could,
  via free text). This is treated as acceptable: the side panel's own picker
  already requires a manual model entry for such providers (decisions/22),
  and using it once seeds the default the same way it always has.

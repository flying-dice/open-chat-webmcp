---
column: review
labels: [frontend, bug]
priority: med
agent: sonnet
live: false
updatedAt: 2026-08-19T23:10:00.000Z
---
# "Set as default" bypasses the tool-capability check

Flagged by card 35 while implementing forced model selection, from
`src/sidepanel/**` — the fix belongs in `src/options/**`, so it was reported
rather than reached for.

The side panel's picker is careful about capability: models reporting `no-tools`
or `unknown` are shown disabled with an inline reason, per
decisions/11-provider-capability-detection.md, so a user cannot pick something
that silently ignores every page tool.

The options page's "Set as default" applies no such check. A default set there can
name a model with no tool-calling support, which then seeds new chats. Card 35
makes that seeded value non-explicit so the user is asked to confirm before their
first message — which contains the damage — but the underlying setting is still
one the picker itself would refuse to let them make.

Two surfaces disagreeing about what is a valid selection is the same class of
inconsistency as the 403 (card 33): each is defensible alone, together they are
confusing.

Fix: apply the same three-state capability rule at the point the default is set.
A `no-tools` model should not be settable as a default; `unknown` should follow
whatever decision 11 says the picker does, so the two behave identically.

## Checklist

- [x] Capability checked when setting a default, matching the panel picker exactly
- [x] `no-tools` refused with the same inline reason wording the picker uses
- [x] `unknown` handled the same way the picker handles it
- [x] An existing stored default that is now invalid surfaces clearly rather than silently

## Gates

- [x] check — svelte-check + tsc: 165 files, 0 errors, 0 warnings (sonnet, 2026-08-19T23:10:00.000Z)
- [x] build — `npm run build` green (sonnet, 2026-08-19T23:10:00.000Z)
- [x] verify — `npm run verify` 9/9 required checks passed (sonnet, 2026-08-19T23:10:00.000Z)

## Comments

- **sonnet** (2026-08-19T22:50:00.000Z): Claimed the card. Read decisions/11 + decisions/06 and the panel's actual picker implementation — `src/sidepanel/components/ProviderPicker.svelte:119-139` had its own private `capabilityBadge`/`reasonFor` helpers, and `src/sidepanel/stores/selection.svelte.ts:316-330` (`resolveCapabilities`) + `:350-365` (`enterManualModel`) each hand-rolled the same "fold a failed `getCapabilities` into `unknown`" fallback. Meanwhile `src/options/components/ProvidersSection.svelte:100-103` (`handleSetDefault`) called `setDefaultSelection` directly off `provider.defaultModel` with zero capability check at all — confirmed the bug as described.
- **sonnet** (2026-08-19T23:00:00.000Z): Extracted the shared rule into a new module, `src/lib/providers/capability.ts`: `resolveCapability` (the getCapabilities-with-unknown-fallback), `isSelectable` (the one true "tool-capable, and nothing else" check), `capabilityBadge`, and `reasonForCapability`. Rewired `ProviderPicker.svelte` and `selection.svelte.ts` to import these instead of their private copies — no behavior change there, just de-duplication (card 31's ethos). Then wired the options page onto the same module: `src/options/components/ProvidersSection.svelte` now runs `refreshDefaultModelChecks()` (checks every provider's `defaultModel` capability up front, same proactive treatment the picker gives its model list) and `refreshStaleDefault()` (checks the CURRENTLY STORED default), both on load and after every add/edit/remove. `ProviderRow.svelte`'s "Set as default" button (`:120-122`) is now disabled whenever the model isn't confirmed tool-capable, with the picker's exact inline reason shown via `.hint` text (`:129-133`) — matching the picker's muted, non-alarming treatment for a disabled row. `handleSetDefault` (`ProvidersSection.svelte:217-224`) re-checks before writing as a second guard, mirroring `selectModel`'s own defense-in-depth pattern in `selection.svelte.ts`. The 4th checklist item (already-stored invalid default) surfaces as a `.note--warning` banner at the top of the section (`ProvidersSection.svelte:275-285`) plus a danger-colored "Default — needs attention" badge on the affected row (`ProviderRow.svelte:89-95`), both added to `src/options/options.css:48-67`. Confirmed decisions/18 keeps the options page off the side-panel design system (Icon.svelte/icons.ts/chat-theme.css) entirely — options.css/decision 08 only, no cross-import.
- **sonnet** (2026-08-19T23:08:00.000Z): `npm run check` (165 files, 0 errors) and `npm run build` both green. `npm run verify` 9/9. Then drove the real built options page in Chrome for Testing (a throwaway script under the scratchpad dir, borrowing `verify/lib/browser.mjs`'s `launchExtension`) against seeded OpenAI-compatible providers exercising all three capability states plus a stored-invalid default: confirmed the stale-default banner shows the exact "Confirmed not to support tool calling." wording, the no-tools/unknown rows disable "Set as default" with the picker's exact reasons ("Not on the OpenAI tool-calling allowlist; support unverified." for unknown), the no-model-configured row shows its own hint, clicking "Set as default" on the tool-capable row actually persists and clears the banner, and a second run against a genuinely unreachable Ollama provider (real network client, not the static OpenAI allowlist) folds the connection error into the same disabled-with-reason treatment with no console/page errors. Moving to review.

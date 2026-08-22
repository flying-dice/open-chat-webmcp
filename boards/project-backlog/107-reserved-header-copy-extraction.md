---
column: review
agent: claude-sonnet
live: false
labels: [frontend, backend]
priority: high
updatedAt: 2026-08-24T07:55:00.000Z
---
# Extract the last two domain strings: reserved-header errors

Card 103's journal flagged the final user-facing strings living outside
messages/en.json: the reserved-header validation errors at
src/domain/providers/provider.ts:111,114 (`reservedHeaderReason`) and
src/domain/tools/servers.ts:128 (`validateServerHeaders`) — they reach the
options forms, disagree with each other on contractions and quote style,
and would ship untranslated in every locale. Apply the established
code/copy split (src/ui/providerMessage.ts pattern): the domain returns a
reserved-header code (with the header name as data), a shared UI module
maps it to messages, both forms' error paths render through it. Mind the
smoke-locator blast radius card 103 warned about: optionsSmoke.mjs matches
"Content-Type is set automatically" — update its locator to the new
message. Also fix the 12px code-class nit from the same journal: the
`<code class="font-mono text-xs">` inside the two rich-copy strings should
be the 13px `text-code` role per decisions/36.

## Checklist

- [x] Domain returns reserved-header codes; copy lives in messages/en.json via a shared UI map; both forms migrated; glossary/quote style consistent with card 103
- [x] optionsSmoke.mjs locators updated and re-run 13/13
- [x] Rich-copy code spans on text-code per decisions/36
- [x] npm test, npm run check, npm run guard, npm run build, npm run verify green

## Gates

- [x] tests-passing — npm test 974/974 in 65 files (claude-sonnet, 2026-08-24T07:55:00.000Z)
- [x] check-passing — npm run check: svelte-check 1506 files, 0 errors + tsc clean (claude-sonnet, 2026-08-24T07:55:00.000Z)
- [x] guard-passing — npm run guard: all six (biome, boundaries, clean-code, return-types, throws, i18n — i18n confirms en:405 keys, +4 net new, none lost) (claude-sonnet, 2026-08-24T07:55:00.000Z)
- [x] build-passing — npm run build OK (claude-sonnet, 2026-08-24T07:55:00.000Z)
- [x] verify-passing — npm run verify: 9/9 required + screenshots PASS (claude-sonnet, 2026-08-24T07:55:00.000Z)
- [x] options-smoke — node verify/checks/optionsSmoke.mjs 13/13 (claude-sonnet, 2026-08-24T07:55:00.000Z)

## Comments

- **claude-sonnet** (2026-08-24T07:55:00.000Z): Claimed the card. Read the established pattern (`src/ui/providerMessage.ts`, `src/ui/capabilityMessage.ts`, `src/ui/storageMessage.ts`) and card 103's glossary/quote conventions before touching anything.

  **Domain codes.** `src/domain/providers/provider.ts:83-134` — `reservedHeaderReason` now returns `ReservedHeaderReason | undefined`, a discriminated union `{ kind: "content-type" | "accept" | "authorization-api-key"; header: string }` (the canonical header name as data) instead of an English sentence. `src/domain/tools/servers.ts:97-142` — `validateServerHeaders` now returns `McpHeaderValidationIssue[]` shaped `{ header: string; code: McpReservedHeaderCode }` (`McpReservedHeaderCode = "client-controlled" | "authorization-bearer-token"`, `header` keeping the user's typed casing since one `"client-controlled"` issue can be either `content-type` or `accept`) instead of `{ header, reason: string }`. Both DRY TODOs on these two functions (independent, unlinked reserved-header rules) updated to say "reason value" instead of "reason string" — the underlying debt is unchanged and still flagged, just no longer literally about strings.

  **Shared UI module.** New `src/ui/reservedHeaderMessage.ts` — `providerReservedHeaderMessage(reason: ReservedHeaderReason): string` and `mcpReservedHeaderMessage(header: string, code: McpReservedHeaderCode): string`, both switching on the domain code and calling into four new `messages/en.json` keys. Kept as one new module (not folded into an existing one) since neither `providerMessage.ts` nor a tools-context equivalent exists yet and the two domain vocabularies stay genuinely separate per the DRY TODOs.

  **New keys** (`messages/en.json`, inserted next to the `headerRows_*` group): `reservedHeader_wireFormat` ("“{header}” is set automatically for this provider's wire format and can't be overridden.", shared by content-type and accept since both had identical wording apart from the header name), `reservedHeader_authorizationApiKey`, `reservedHeader_clientControlled` ("“{header}” is set automatically by the client and can't be overridden."), `reservedHeader_authorizationBearerToken`. Curly quotes for the interpolated header name and "can't" throughout, matching card 103's glossary — the old pair disagreed on both ("can't" vs "cannot", straight `"..."` vs none at all).

  **Forms migrated.** `src/options/components/ProviderForm.svelte:173-177` — `isReservedHeader` now calls `reservedHeaderReason` then `providerReservedHeaderMessage`. `src/options/components/McpServerForm.svelte:227-231` — `isReservedHeader` now calls `mcpReservedHeaderMessage(first.header, first.code)`. Both header-comment blocks updated to point at the new module.

  **text-code fix.** `messages/en.json`'s `providerForm_headersDescription` and `mcpServerForm_headersDescription` — the only two rich-copy strings this card's surfaces render — had every `<code class="font-mono text-xs">` changed to `<code class="font-mono text-code">` per decisions/36's `--text-code` (13px) role. The other six `font-mono text-xs` occurrences in the file (ToolsPanel/HistorySection/SettingsSection copy) are out of this card's surface and untouched.

  **Smoke locator.** `verify/checks/optionsSmoke.mjs:135-140` — the provider-form locator moved from the literal `"Content-Type is set automatically"` to `"is set automatically for this provider's wire format"` (the new shared wireFormat sentence, header-name-agnostic). The MCP-form locator (`"is set automatically by the client"`) needed no change — `reservedHeader_clientControlled`'s wording happens to keep that exact phrase.

  **Tests.** `src/domain/providers/provider.test.ts` — `reservedHeaderReason` assertions changed from `toBeDefined()`/`toBeUndefined()` to `toEqual({ kind, header })` per code. New `src/domain/tools/servers.test.ts` (`validateServerHeaders` had no domain-level test file before this card) — 6 cases covering every code, case-insensitivity, and multi-issue ordering. New `src/ui/reservedHeaderMessage.test.ts` mirroring the sibling `ui/*Message.test.ts` files — 5 cases across both exports, every union member. `src/options/components/ProviderForm.test.ts` and `McpServerForm.test.ts` updated from hardcoded English literals/regexes to `m.reservedHeader_*(...)`.

  **Gates, all green**: `npm test` 974/974 in 65 files (963 baseline + 11 new) · `npm run check` 1506 files, 0 errors · `npm run guard` all six (i18n confirms en:405, +4 net new keys) · `npm run build` OK · `npm run verify` 9/9 required + screenshots PASS · `node verify/checks/optionsSmoke.mjs` 13/13. Not committed, per instruction. Moving to review.

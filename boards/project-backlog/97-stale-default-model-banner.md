---
column: review
agent: claude
live: false
labels: [bug, frontend]
priority: high
updatedAt: 2026-08-23T14:40:00.000Z
---
# Options: stale default-model error banner

Reported by Jonathan with a screenshot (2026-08-23): the Chat providers
section shows "The default provider/model can no longer be confirmed as
tool-capable: Provider returned 400 Bad Request: {\"error\":\"model is
required\"} … Pick a new default below." plus a "Default — needs attention"
badge — but the product no longer has a default *model* or any way to
select one in the options page, so this staleness subsystem is probing the
capability endpoint with no model and misreporting its own 400 as a user
problem. The SRP audit already flagged this subsystem as ~1/3 of
ProvidersSection (src/options/components/ProvidersSection.svelte).

Investigate first, then fix:

1. Establish the current source of truth: what does `providers:default`
   (domain ProviderSelection) actually store and who reads it — does the
   side panel still seed from a default model anywhere (selection store,
   chat service), or is the default now provider-only / fully explicit
   (decisions 22/23, cards 35/51/52 lineage)?
2. If the default-model concept is truly gone from the product: remove the
   capability/staleness probe subsystem from ProvidersSection, the
   "needs attention" badge state, and the "Pick a new default below" copy;
   the section description ("Exactly one provider (and model) is the
   default…") gets rewritten to match reality. If the stored shape still
   carries a dead `model` field nothing reads, drop it (pre-release, no
   migration) and record that in the journal; a storage-shape change gets a
   decision record.
3. If something DOES still read a default model, fix the probe instead
   (never probe with an empty model; surface the real state) and journal
   why the concept stays.

## Checklist

- [x] Current default-selection reality established and journalled with path:line evidence
- [x] Stale banner/badge/copy corrected to match; no probe ever fires without a model
- [x] Root-cause dead-storage state fixed at its source; tests updated (storage adapter + fixtures reviewed, no shape change needed)
- [ ] Options screenshot check still PASS (it asserts section headings; re-check any banner-dependent expectation from card 86) — not run, see Gates note (verify deferred to coordinator)
- [x] npm test, npm run check, npm run guard, npm run build green; npm run verify deferred to the coordinator's post-batch run (parallel agent has the harness)

## Gates

- [x] tests-passing — `npm test`: 56 files, 862/862 passing (861 pre-existing + 1 new regression test) (claude, 2026-08-23T14:35:00Z)
- [x] check — `npm run check`: svelte-check + tsc, 1076 files, 0 errors, 0 warnings (claude, 2026-08-23T14:36:00Z)
- [x] guard — `npm run guard`: clean-code scan, nothing above the 0.5 threshold (all findings pre-existing, none introduced by this change) (claude, 2026-08-23T14:36:30Z)
- [x] build — `npm run build`: vite build succeeded, 6992 modules (claude, 2026-08-23T14:37:00Z)
- [ ] verify — deliberately NOT run per instructions (a parallel agent applying decisions/36 across many components may still need the harness); coordinator runs `npm run verify` post-batch

## Comments

- **claude** (2026-08-23T14:00:00.000Z): Claimed the card. INVESTIGATE-FIRST step 1: is the default-model concept actually gone? Evidence says emphatically no.
  - `src/domain/providers/registry.ts:90-93` — the `ProviderRegistry` port still declares `getDefaultSelection()`/`setDefaultSelection(selection: ProviderSelection)`, `ProviderSelection` still carries `{providerId, model}` (`registry.ts:47-51`, pre-edit).
  - `src/sidepanel/stores/selection.svelte.ts:280-310` (`syncToTab`) — every brand-new tab reads `getDefaultSelection()` and, if that tab has no per-chat selection yet, seeds the chat with it (`chat().setSelection(newTabId, defaultSelection, false)` at line 304) — this is the live seed-path for new chats, still wired.
  - `src/sidepanel/stores/selection.svelte.ts:449-468` (`selectModel`) — the FIRST time a user deliberately picks a model with no default yet set, this writes it as the new global default (`if (!currentDefault) await registry.setDefaultSelection(next)` at 464-465).
  - `src/options/components/ProvidersSection.svelte:312-319` (`handleSetDefault`) and `src/options/components/ProviderRow.svelte:184-206` — the options page's "Set as default" button + per-provider tool-capable-model `<select>` is very much still rendered and wired, contradicting Jonathan's read that there's "no way to select one in the options page."
  - `decisions/23-default-model-from-known-list-not-free-text.md` and card 52's journal (`boards/project-backlog/52-default-model-from-known-list.md`) confirm this is deliberate, recent (2026-08-20) design: the free-text "Default model (optional)" field was replaced with the loaded-list dropdown, not removed as a concept.
  - Verdict: **branch 3 applies** — the default-model concept is alive and load-bearing on both surfaces. The subsystem in ProvidersSection stays; the bug is in the probe, not the premise.
- **claude** (2026-08-23T14:15:00.000Z): Traced the actual 400. `refreshStaleDefault` (`ProvidersSection.svelte:183-202`, pre-edit) calls `resolveCapability(client, { id: resolved.model, name: resolved.model })` where `resolved.model` comes straight from the stored `providers:default`'s `model` field. `src/infra/ollama/client.ts:377-411` (`getCapabilities`) POSTs `/api/show` with `body: JSON.stringify({ model: model.name })` — an empty `model.name` reproduces exactly the reported `400 {"error":"model is required"}`. Confirmed every CURRENT write path guards against an empty model before ever calling `setDefaultSelection` (`ProviderRow.svelte`'s dropdown only renders once `defaultModelOptions.length > 0`; `selectModel` only writes after `isSelectable(entry.capability)`), so a fresh install can't reproduce this — but `src/infra/chrome-storage/provider-registry.ts`'s `isProviderSelection` (pre-edit, line 74-76) only checked `typeof v.model === "string"`, accepting an empty string as a fully valid selection, unlike its sibling `decodeProviderCore` two lines above which requires `v.id.length > 0`. Root cause: this is a corrupted-storage class of bug — a `providers:default` record can carry `model: ""` (most plausibly a leftover from decisions/23's now-removed free-text `defaultModel` field, which decision 23 itself describes as "optional" and blank-able, predating today's guarantees), and the adapter happily decodes it as a real selection, which `refreshStaleDefault` then probes with an empty model id.
- **claude** (2026-08-23T14:25:00.000Z): Fix applied at the read boundary (the one place both surfaces get `providers:default` back), matching the existing defensive-decode convention rather than patching each caller: `src/infra/chrome-storage/provider-registry.ts:74-89` — `isProviderSelection` now also requires `v.model.length > 0`, so `getDefaultSelection()` decodes an empty-model record as "no default" (mirrors `decodeProviderCore`'s `v.id.length > 0` pattern two lines up in the same file). This means `ProvidersSection.svelte`'s `refreshStaleDefault` can no longer structurally receive an empty model to probe with — no component change needed, no banner/badge/copy change needed, since the "Chat providers" description ("Exactly one provider (and model) is the default…") is accurate per the branch-3 verdict above. Considered also hardening `src/infra/chrome-storage/chat-store.ts`'s near-identical `isProviderSelectionLike` (per-chat selection decode, lines 84-86) the same way, but declined: unlike the global-default case, tightening that check would flip `isChatSession` to reject the WHOLE chat session on a corrupted `selection` sub-field (larger blast radius — losing a user's chat history vs. losing a stale default pointer), it protects a path that never does a live network probe (`selection.svelte.ts:203-208`'s `activeCapability` only does a local lookup against already-loaded models, never re-probes), and nothing evidenced it as part of the reported bug. Left as-is; noted here rather than silently skipped. Documented the invariant on the domain type itself: `src/domain/providers/registry.ts:47-60` (`ProviderSelection` doc comment) now states the non-empty-model expectation and why, for the next reader.
- **claude** (2026-08-23T14:35:00.000Z): No storage-shape change (the `ProviderSelection`/`providers:default` TypeScript shape is unchanged — `model: string` stays required; only the runtime decode got stricter about an already-invalid value), so no decision record needed per the card's own branch-2-only instruction. Added `src/infra/chrome-storage/provider-registry.test.ts`'s new case in the existing "defensive decoding of corrupted/foreign-written storage" block (matching its established pattern): seeding `providers:default` with `{providerId: "p1", model: ""}` and asserting `getDefaultSelection()` resolves `undefined`. `src/infra/chrome-storage/testing/storage-fixtures.mjs` needed no change — its `FIXTURE_MODEL` (`storage-fixtures.mjs:552`) was already a real, non-empty model id. No clean-code markers to clear (nothing was removed — the ProvidersSection SRP marker at `ProvidersSection.svelte:2` correctly still describes the surviving staleness subsystem). Gates: `npm test` 862/862, `npm run check` 0 errors, `npm run guard` nothing above 0.5 (introduced nothing new), `npm run build` green — all recorded under `## Gates`. `npm run verify` deliberately skipped per instructions (parallel decisions/36 agent may need the harness); coordinator runs it post-batch. Moving to review.

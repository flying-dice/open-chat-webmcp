---
column: doing
agent: claude
live: true
progress: 5
status: Queued behind card 90 — same files in flight
labels: [bug, frontend]
priority: high
updatedAt: 2026-08-23T10:40:00.000Z
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

- [ ] Current default-selection reality established and journalled with path:line evidence
- [ ] Stale banner/badge/copy removed or corrected to match; no probe ever fires without a model
- [ ] Dead code and its clean-code markers cleared; tests updated (ProvidersSection paths, storage fixtures if the shape changed)
- [ ] Options screenshot check still PASS (it asserts section headings; re-check any banner-dependent expectation from card 86)
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

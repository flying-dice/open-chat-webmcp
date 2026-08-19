---
column: review
labels: [docs]
priority: low
updatedAt: 2026-08-19T21:40:00.000Z
---
# Generalize naming and docs for multi-provider

Sweep remaining Ollama-only wording once cards 20-23 ship: `package.json`
description ("chat with a local Ollama model..."), README (card 17), and any UI copy
that still assumes a single provider. The target name for that sweep is now
"OpenChat (WebMCP)" — see decisions/12-branding-openchat-webmcp.md and card 26.

## Checklist

- [x] Update `package.json` name/description
- [x] Update README once it exists (card 17) to describe multi-provider setup
- [x] Sweep UI copy/placeholders for lingering "Ollama"-only assumptions

## Comments

- **claude** (2026-08-19T21:40:00.000Z): Card 26 retargeted this card, as
  its own description already noted — this card originally tracked "sweep
  remaining Ollama-only wording" with no fixed target name; card 26 supplied
  that target ("OpenChat (WebMCP)", decisions/12-branding-openchat-webmcp.md)
  and the concrete checklist (manifest, package.json, options/side panel
  titles, README). What was left for *this* card specifically was the
  substance both cards shared: `package.json`'s name/description
  (`package.json:2,16`) and the README's multi-provider framing
  (`README.md:8-16`, already describing both Ollama and OpenAI-compatible
  setup per decision 09 — the only stale piece was the "rename pending"
  naming note, now replaced). Did both together with card 26 in one pass
  rather than duplicating the sweep; see card 26's comment for the full
  file-by-file account, including the UI-copy review
  (`src/sidepanel/components/ProviderPicker.svelte`,
  `src/options/components/ProvidersSection.svelte`) that confirmed no
  single-provider-assuming UI copy remained to sweep. `npm run check`,
  `npm run build`, and `npm run verify` (9/9) all green. Moving to review
  alongside card 26.

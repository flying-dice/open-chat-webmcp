---
column: review
labels: [docs]
priority: med
updatedAt: 2026-08-19T21:40:00.000Z
---
# Branding: rename to "OpenChat (WebMCP)"

Adopt the new product name across the project per
decisions/12-branding-openchat-webmcp.md. Supersedes/retargets the naming
sweep in card 24.

## Checklist

- [x] `package.json`: `name` → `openchat-webmcp`, `description` updated to
      drop the Ollama-only framing
- [x] `manifest.config.ts`: `name` → "OpenChat (WebMCP)"
- [x] Options page title/header (card 13) updated to the new name
- [x] Side panel header/empty states (card 07, 14) swept for the old name
- [x] README (card 17) updated to the new name once it exists
- [ ] Store listing copy (card 19) updated to the new name — not applicable
      yet: card 19 (packaging/store listing) is still in `backlog` and no
      store listing copy exists in the repo to update.
- [x] Icons/screenshots referencing "Ollama WebMCP" text refreshed if any —
      checked `icons/*` (PNG/SVG); no embedded "Ollama WebMCP" text found, so
      nothing to refresh.

## Comments

- **claude** (2026-08-19T21:40:00.000Z): Renamed user-facing identifiers per
  decisions/12-branding-openchat-webmcp.md: `package.json:2` name →
  `openchat-webmcp` (and its description at `package.json:16` dropped the
  Ollama-only framing), `manifest.config.ts:9` name → "OpenChat (WebMCP)",
  `src/options/index.html:6` and `src/options/App.svelte:13` title/header →
  "OpenChat (WebMCP) — Options", `src/sidepanel/index.html:6` title →
  "OpenChat (WebMCP)", `README.md:1` heading → "OpenChat (WebMCP)" plus a new
  short naming note at `README.md:8-16` replacing the old "rename is
  pending" caveat (which is now false) with a pointer to decision 12 and an
  explicit note that the repo directory/remote stay as `ollama-webmcp-chrome`
  by design. Also regenerated `package-lock.json`'s `name` field (via `npm
  install --package-lock-only`) so it doesn't drift from `package.json`.
  Did NOT touch: `src/lib/ollama.ts`, `src/lib/providers/ollama.ts`, the
  `"ollama"` provider type id (`src/lib/providers/registry.ts:319`), any
  `ollama:`-prefixed storage key, or the Ollama-specific troubleshooting
  copy in `docs/04-troubleshooting.md:14-31` and the CORS section in
  `README.md` — all correctly describe Ollama as *a* provider, not the only
  one, and two of them are persisted-data identifiers that must not move.
  Reviewed `src/sidepanel/components/ProviderPicker.svelte`,
  `src/options/components/ProvidersSection.svelte`, and
  `src/sidepanel/App.svelte`'s empty-state copy (cards 07/14) — all already
  phrase things provider-generically ("Add a provider below to let the side
  panel connect to Ollama or an OpenAI-compatible..."), with Ollama-specific
  hints gated behind `isOllama` checks, so no changes were needed there.
  Verified `npm run check` (137 files, 0 errors), `npm run build` (manifest
  output confirmed at `dist/manifest.json` with the new name/description),
  and `npm run verify` (9/9 required checks passed) all green after the
  sweep. Moving to review.

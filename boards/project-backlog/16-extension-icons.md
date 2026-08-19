---
column: review
labels: [infra]
priority: low
agent: claude
updatedAt: 2026-08-19T16:35:00.000Z
---
# Extension icons

Toolbar and store icons at 16/32/48/128. Should sit comfortably in a Chrome
toolbar next to Chrome's own iconography rather than competing with it
(decisions/08-native-chrome-design-language.md) — a single-weight mark that still
reads at 16px.

## Checklist

- [x] Source SVG mark
- [x] Export 16 / 32 / 48 / 128 PNGs
- [x] Check at 16px on light and dark toolbars
- [x] Wire into `icons` and `action.default_icon`

## Comments

- **claude** (2026-08-19T16:35:00.000Z): Added the source mark at icons/icon.svg — a single-colour (`#4C8BF5`) chat bubble with three "typing" dots punched out as negative space via `fill-rule="evenodd"` (icons/icon.svg:9-31), so the dots reveal whatever is behind the icon (Chrome's light or dark toolbar) instead of needing separate light/dark artwork. Rasterised with `rsvg-convert` (available on this machine, confirmed via `which rsvg-convert`) to icons/icon-16.png, icons/icon-32.png, icons/icon-48.png, icons/icon-128.png. Checked legibility by rendering the SVG at 16px against both a light (`#f1f3f4`) and dark (`#323639`) background and upscaling with `sips` to inspect pixel-level clarity — the bubble silhouette and all three dots stay distinct at both sizes and both themes. Wired into manifest.config.ts:16-22 (`icons`) and manifest.config.ts:31-39 (`action.default_icon`); confirmed the built dist/manifest.json carries both blocks correctly and `npm run build` copies all four PNGs into `dist/icons/`. `npm run check` also green. Could not open real Chrome to see it in a live toolbar, so that's left for human/reviewer confirmation. Note: the icon's blue (`#4C8BF5`) is close to but not identical to `--color-primary` (`#0b57d0`) in src/lib/theme.css:96 — the panel itself carries no accent colour of its own per decisions/08, so the two were not deliberately unified; worth a look if brand consistency between toolbar mark and any future in-panel primary usage matters.

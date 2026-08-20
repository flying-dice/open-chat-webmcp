---
column: review
labels: [infra]
priority: low
agent: claude
updatedAt: 2026-08-20T00:00:00.000Z
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
- **claude** (2026-08-20T00:00:00.000Z): Jonathan supplied a new source mark (two overlapping speech bubbles, green `#2AD252`/`#73DA7E` over navy `#444564`, plus white "lines of text" instead of dots) and asked for it to replace the existing one. Swapped it into icons/icon.svg and re-rasterised icons/icon-16.png, icons/icon-32.png, icons/icon-48.png, icons/icon-128.png with `rsvg-convert`. Checked the 16px render upscaled with `sips` — the two-bubble silhouette and the white bars stay distinct at 16px. One regression versus the mark this replaces: that one used negative-space cutouts so it worked on any toolbar colour without separate art; this one is a flat two-colour icon, so the navy bubble will read low-contrast on Chrome's dark toolbar. Flagged to Jonathan; no separate dark-toolbar variant was requested, so none was made. manifest.config.ts:28-33/44-49 already point at the same `icons/icon-*.png` paths, so no manifest change was needed.

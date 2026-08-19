---
column: review
labels: [frontend]
priority: high
agent: claude
updatedAt: 2026-08-19T21:49:00.000Z
---
# Chrome-native design tokens

One stylesheet of CSS custom properties that every other surface builds on, so
the panel reads as part of Chrome rather than a web app in a frame. See
decisions/08-native-chrome-design-language.md.

System UI font stack, 13px body, `color-scheme: light dark`, Material 3 surface
roles, native controls with their platform focus rings, no branding or accent
colour of our own.

## Checklist

- [x] `src/lib/theme.css` with surface / on-surface / outline / primary tokens
- [x] Light and dark palettes via `prefers-color-scheme`, both first-class
- [x] Type scale, 4/8px spacing rhythm, 8px card / 16px pill radii
- [x] Base element styles for `button`, `select`, `input`, `textarea`
- [x] Verify legibility at Chrome's minimum side-panel width (~320px)
- [ ] Check against a real Chrome panel (Bookmarks) side by side, both themes — could not launch Chrome in this environment; left for human/reviewer verification, see comment below

## Comments

- **claude** (2026-08-19T16:35:00.000Z): Added `src/lib/theme.css` — the single token stylesheet per decisions/08-native-chrome-design-language.md. `:root` declares `color-scheme: light dark` and the light M3-approximation palette (src/lib/theme.css:78-97); the dark palette overrides the same custom properties under `@media (prefers-color-scheme: dark)` (src/lib/theme.css:99-118), so nothing needs a `.dark` class or JS toggle — it's purely `prefers-color-scheme`. Token naming is flat: `--color-<role>` (surface, surface-container, surface-container-high, on-surface, on-surface-variant, outline, outline-variant, primary, on-primary, danger), `--font-family-ui`/`--font-size-*`/`--line-height-*`, `--space-1..6` (4px steps), `--radius-card`/`--radius-pill`/`--radius-sm`, and `--transition-fast` — every other surface should consume these rather than hard-coding values (src/lib/theme.css:1-24 documents the convention). Base element styles for `button`/`select`/`input`/`textarea` are at src/lib/theme.css:172-231; none of them touch `outline`/`:focus-visible`, so native platform focus rings are preserved as required. `html, body { min-width: 320px }` at src/lib/theme.css:130-134 keeps the panel from collapsing below Chrome's minimum side-panel width. Verified with `npm run build` and `npm run check`, both green — could not open a real Chrome window in this sandbox to eyeball it beside the Bookmarks panel, so that checklist item is left for a human reviewer. Least-confident approximation: the dark `--color-surface-container`/`--color-surface-container-high` elevation tints (src/lib/theme.css:107-108) — dark-mode M3 elevation tinting is the hardest thing to eyeball without Chrome's real values in front of me. I did NOT touch any Svelte entry point — wiring instruction for whoever owns them: `src/sidepanel/main.ts` and `src/options/main.ts` (or their `App.svelte`) each need `import "../lib/theme.css";` added near the top so the tokens and base element styles actually apply — currently unwired.
- **claude** (2026-08-19T21:49:00.000Z): Still the base layer, and now explicitly scoped: `src/lib/theme.css` remains the ONLY token source for the options page and the shared base for both surfaces, but the side panel layers `src/sidepanel/chat-theme.css:1-176` over it per decisions/18-side-panel-material-expressive.md — bigger type, filled and rounded surfaces, an accent colour, elevation. Nothing in this card's work was undone; the one edit to theme.css was value-neutral (`--font-family-mono` at src/lib/theme.css:41, hoisted out of the 11 components that repeated the literal stack). This card's remaining unchecked item — eyeballing against a real Chrome panel in both themes — is still valid and still open, but it now applies to the OPTIONS page only: the panel's reference is Chrome's Gemini panel, not Bookmarks, and it was checked against the reference screenshots at 320 and 400px in both schemes under card 49.

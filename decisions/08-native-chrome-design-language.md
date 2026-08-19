---
status: Accepted
date: 2026-08-19
---
# Decision 08 — The UI adopts Chrome's own design language, not a custom brand

## Context

The side panel sits inside Chrome's chrome, docked next to the browser's own
panels (Bookmarks, Reading List, History). Anything with its own colour palette,
font, or component style reads as a foreign object bolted onto the browser. The
goal is that the panel feels like a part of Chrome that happens to talk to
Ollama.

## Decision

Match Chrome's native surfaces rather than inventing a design system.

- **Type:** the system UI stack Chrome itself uses — `system-ui, -apple-system,
  "Segoe UI", Roboto, sans-serif`. Body text at 13px, matching Chrome's UI, not
  a 16px web-page default.
- **Colour:** declare `color-scheme: light dark` and derive the palette from
  Chrome's Material 3 surface roles (surface, surface-container, on-surface,
  outline, primary). Light and dark are both first-class and follow
  `prefers-color-scheme` — the panel must never be a light rectangle inside a
  dark browser.
- **Controls:** native `<select>`, `<button>`, `<input>` styled minimally and
  left with their platform focus rings. Chrome's own 4/8px spacing rhythm, 8px
  radius on cards and 16px on pill controls, 1px `outline`-coloured dividers
  instead of shadows.
- **No branding:** no logo lockup, no accent colour of our own, no custom
  scrollbars, no animation beyond the ~150ms ease Chrome uses for its own state
  changes.
- Tool cards, approval prompts, and the inspector reuse the same small set of
  surface/outline tokens so the panel reads as one Chrome surface rather than a
  web app in a frame.

All tokens live in one stylesheet as CSS custom properties, so the theme is a
single file to audit and adjust.

## Consequences

- The panel is legible at Chrome's minimum side-panel width and inherits the
  user's OS theme without extra work.
- Restraint is a constraint on later features: new UI must be expressible in the
  existing token set, not by adding colours.
- Chrome's Material tokens are not exposed to extensions as real CSS variables,
  so the palette is a hand-maintained approximation and may drift as Chrome's UI
  evolves. Keeping it in one file makes that a small, contained update.
- Accessibility comes largely for free — native controls keep their keyboard
  behaviour and focus rings, which a custom component set would have to rebuild.

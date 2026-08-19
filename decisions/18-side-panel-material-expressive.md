---
status: Accepted
date: 2026-08-19
---
# Decision 18 — The side panel adopts Material 3 expressive, at Chrome's Gemini-panel scale

Revises [decisions/08](08-native-chrome-design-language.md) for the SIDE PANEL
only. Decision 08 continues to govern the options page unchanged, and remains
the base layer the panel builds on.

## Context

Decision 08 set out to make the panel read as part of Chrome by matching the
browser's plainest surfaces — the Bookmarks and Reading List panels. It called
for 13px body text, no accent colour, no shadows, 1px outlines, and Unicode
glyphs rather than icons.

The reference for a chat panel in Chrome has since moved. Chrome ships its own
AI side panel, and it is not styled like Bookmarks: it is Material 3 expressive
— roughly 16px body text, fully rounded surfaces, filled containers instead of
outlines, real icons, a blue accent, and elevation on anything that floats. It
is still Chrome's design language; it is just the conversational half of it,
which did not exist when decision 08 was written.

Matching the Bookmarks panel was never the goal in itself. Not looking like a
foreign object inside the browser was. For a chat surface, the panel Chrome
itself ships for chat is the closer target.

## Decision

The side panel follows Chrome's Gemini-panel visual language. Concretely, and in
each case reversing something decision 08 asked for:

- **Scale.** Body text is 16px, not 13px. The panel is read in paragraphs, not
  scanned as a row of browser chrome.
- **Accent.** An accent colour of our own is permitted — `--color-primary` for
  links and selection, `--color-accent-sparkle` for the assistant-turn glyph,
  `--color-secondary-container` for selected rows. Decision 08 forbade this.
- **Elevation.** Menus, sheets and the jump-to-latest control carry Material
  elevation shadows. Decision 08 mandated 1px outlines and no shadows; outlines
  remain for the composer box and dividers only.
- **Surfaces.** Cards are filled, not outlined, and much rounder: 12px for tool
  cards, 16px for notices/menus/sheets/composer, 20px for the user's message
  bubble, full pills for chips and icon buttons.
- **Icons.** A bundled Apache-2.0 Material Symbols path map (`src/lib/icons.ts`)
  replaces the Unicode-glyph rule. Paths are inlined rather than delivered as a
  webfont: ~4KB gzipped into the existing bundle against ~4MB unsubsetted, no
  `font-src` question, and no FOUT on a panel that opens and closes constantly.
- **Layout.** The header carries the conversation's title and two icon actions;
  the page indicator, connection state and tool count move to a context chip
  above the composer; the model picker becomes a chip inside the composer; and
  recent chats, the tool inspector and settings live in a kebab overflow menu
  with in-place submenus, replacing the permanent view switcher.

What decision 08 got right and this keeps: light and dark both first-class via
`prefers-color-scheme` with no toggle and no persisted preference; the
`system-ui` font stack, with nothing bundled (Google Sans is not
redistributable, and `system-ui` already resolves to Roboto where Chrome's own
UI uses it); native controls left with their platform focus rings; and every
value in tokens, in one file per surface.

**Isolation.** `src/lib/theme.css` stays the shared base and the options page's
only token source. The panel layers `src/sidepanel/chat-theme.css` over it,
imported only from `src/sidepanel/main.ts`. The two are separate HTML entry
points with separate CSS bundles, so this is structural isolation, not a
convention — the options page cannot pick these tokens up.

### Deliberate deviations from the reference

Three controls in Chrome's panel are not copied, because we have nothing real
behind them and a control that silently does nothing is worse than its absence:

- **No picture-in-picture or close buttons** in the header. There is no
  `chrome.sidePanel.close()` API, and Chrome already draws its own close control
  above ours.
- **No thumbs up/down** under a reply. Nothing consumes a rating.
- **No dismiss "X" on the context chip.** In the reference it detaches the
  shared tab; we have no detach concept, so an X here would appear to stop
  sharing the page while page tools carried on being offered to the model.
  The chip opens the tool inspector instead.

## Consequences

- The panel no longer matches Chrome's *non-chat* panels. Beside Bookmarks it
  now reads as a different kind of surface, which is the intended trade.
- The options page and the side panel are visually divergent by design. They
  share `theme.css`, `Markdown.svelte` and the same token *names*, so a
  component can still be moved between them, but they will not look alike.
- Restraint is no longer the constraint decision 08 made it. The replacement
  constraint is honesty: new UI must not include a control that does nothing.
- The token set is larger and needs maintaining in two files rather than one.
  The dark palette is sampled from Chrome's real panel, so it is more accurate
  than decision 08's approximations; the light palette is derived, and is the
  least verified part of the system.
- Icon paths are third-party Apache-2.0 source vendored into the repo, which
  carries an attribution obligation (SPDX header in `src/lib/icons.ts`, credit
  in `README.md`).

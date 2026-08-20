---
column: review
labels: [frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-20T10:07:00.000Z
---
# Side panel visual system: M3 expressive tokens, icons, message rendering

The panel adopts Chrome's Gemini-panel visual language — bigger type, filled
and rounded surfaces, an accent colour, real icons, and a bubble-less assistant
turn. See decisions/18-side-panel-material-expressive.md.

The options page must be untouched, which is what the panel-only token
stylesheet is for. The overflow menu and the context chip are card 49.

## Checklist

- [x] `src/sidepanel/chat-theme.css`, imported only by `src/sidepanel/main.ts`
- [x] Options page verified byte-identical (its CSS chunk hash is unchanged)
- [x] `--font-family-mono` added to `src/lib/theme.css`; all 11 hardcoded stacks replaced
- [x] `src/lib/icons.ts` + `Icon`/`IconButton`/`Tooltip`, Apache-2.0 header and README credit
- [x] `Header.svelte` rewritten: title + new-chat + kebab, no divider, page background
- [x] `Transcript.svelte`: grey user pill, bubble-less assistant, sparkle turn row
- [x] `MessageActions` (copy + regenerate) with tooltips; no thumbs
- [x] `NoticeCard.svelte`; both banners moved into the transcript
- [x] `Composer.svelte`: outlined box with an inner action row
- [x] `ProviderPicker` trigger reparented into the composer; panel restyled as a model sheet
- [x] `ToolCallCard`/`ApprovalCard`/`Inspector`/`History`/`SegmentedControl` restyle sweep
- [x] `handleRetry` sources the last user turn from `panel.messages`, not `lastSentText`
- [x] `npm run check` + `npm run build` green; screenshots at 320/400 x light/dark

## Comments

- **claude** (2026-08-19T21:49:00.000Z): Built the visual system. Tokens live in a new panel-only stylesheet, src/sidepanel/chat-theme.css:1-176, imported at src/sidepanel/main.ts:2-5 — it redefines theme.css's ten colour roles plus type/radius/elevation/state-layer tokens on `html:root` (specificity 0,1,1, so the override doesn't depend on Vite's chunk emission order) and overrides exactly three base rules from theme.css (`button`, `textarea`, `h3`) rather than resetting them wholesale. Dark values are sampled pixel-by-pixel from the reference screenshots; light is derived and is the least verified block. Isolation is structural and was checked on every build: the options entry links only `theme-*.css` + its own chunk, and that chunk's content hash (`index-cfo8Q8vY.css`) is unchanged from before this card, so the options page is byte-identical. The one edit to the shared file is value-neutral — `--font-family-mono` at src/lib/theme.css:41, replacing the literal stack in 11 components. Icons are inline Apache-2.0 Material Symbols path data (src/lib/icons.ts:1-30 carries the SPDX header and provenance) rendered by src/sidepanel/components/Icon.svelte:1-46; the sparkle is drawn locally rather than copied, since the reference's four-point star is Google's product mark. Message rendering: src/sidepanel/components/Transcript.svelte:126-171 — the user's turn is the only boxed one, the assistant's is bare text on the panel surface with a sparkle+model header row, and MessageActions.svelte gives it copy and regenerate. Deliberately NOT copied from the reference: thumbs up/down (nothing consumes a rating) and the composer's "+" attach button (no attachments exist) — a control that silently does nothing is worse than its absence, which is now recorded in decision 18. Least-confident piece: the light palette in chat-theme.css:80-100, which unlike dark had no reference to sample.
- **claude** (2026-08-19T21:49:00.000Z): Two real bugs found while eyeballing rather than by typecheck. (1) Moving ProviderPicker out of the header into Composer's non-blocked branch broke card 35's blocked state — its "Choose provider & model" button calls `openPicker()`, which sets `selection.pickerOpen`, which does nothing unless a ProviderPicker is mounted to read it. Restructured so the composer box and its action row always render and only the top half swaps (src/sidepanel/components/Composer.svelte:120-205); the picker is now mounted in both states, with a comment at :188-192 saying why. (2) `handleRetry` read `lastSentText`, which is only populated by a send in the current panel lifetime — after a close/reopen it is empty while the message is still in the restored session, so Retry silently did nothing. It now falls back to the last user message in `panel.messages` (src/sidepanel/App.svelte:196-211).
- **claude** (2026-08-20T10:07:00.000Z): Removed a duplicated confirmation the redesign created. Card 35's `needs-confirmation` state carried its own "Use <provider> · <model>" button and "Change" link, which made sense while the model picker lived in the header — but decisions/18 moved the chip into the composer's action row, so the same box was offering the same confirmation twice, one line apart. The state now says what it will use and leaves the confirming to the chip (src/sidepanel/components/Composer.svelte:139-143). `confirmSelection` in src/sidepanel/stores/selection.svelte.ts:457-470 had no callers left and is deleted, with a comment in its place recording why; confirmation now runs through `selectModel`, which the picker already calls when you click a model row. That also closes a hole: `confirmSelection` gated on `resolution.status === "ok"` and never on capability, so it could confirm a model that isn't tool-capable, whereas `handlePickModel` refuses those rows (decisions/06, /11).

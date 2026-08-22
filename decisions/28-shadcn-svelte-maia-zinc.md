---
status: Accepted
date: 2026-08-22
---
# Decision 28 — UI on shadcn-svelte, Maia style, Zinc base color

## Context

The UI is ~2,100 lines of hand-written scoped CSS across 29 side-panel
components plus three competing global stylesheets (`lib/theme.css`,
`sidepanel/chat-theme.css` overriding it by a deliberate specificity trick,
and `options/options.css` — an unversioned mini design system that 7 of 11
options components depend on with no scoped styles of their own). Two
previous design-language decisions (08 native-Chrome, 18 Material
Expressive) produced this hand-rolled system. Maintaining it is a tax on
every UI card, and it has no component library behind it.

Research (2026-08-22, against shadcn-svelte@1.5.0 and its repo) confirmed:
shadcn-svelte is Svelte-5-native on bits-ui, supports plain Vite without
SvelteKit given manual `$lib` alias wiring, and ships the new preset system
whose **Maia** style (soft, rounded, generous spacing — pill buttons/inputs,
`rounded-2xl` cards/menus) is applied as a `.style-maia` per-component
utility overlay. Base color and style are independent knobs, so **Zinc**
tokens (confirmed OKLCH light/dark blocks) combine cleanly with Maia. Maia
pairs with Hugeicons and the Figtree font, both delivered as bundled npm
packages — compatible with MV3's no-remote-assets CSP.

## Decision

- Migrate both UI surfaces (side panel + options) to **shadcn-svelte**
  components with **Tailwind CSS v4** (`@tailwindcss/vite`), **Maia** style,
  **Zinc** base color, dark mode via the `.dark` class synced from
  `prefers-color-scheme`.
- Keep the same information architecture: same screens, flows, menus and
  behaviours (header, overflow menu, chat/inspector/history views, composer
  dock, approval cards, five options sections). This is a re-skin onto a
  component system, not a redesign.
- Generated component source lives in `src/lib/components/ui/` (vendored
  kit — exempt from clean-code and boundary guards).
- **Icons**: standard glyphs move to Hugeicons (Maia's pairing); the custom
  sparkle and Ollama marks stay as local SVGs. `src/lib/icons.ts` shrinks to
  the custom marks only.
- **Typography**: Figtree via `@fontsource-variable/figtree`, bundled
  locally; the build is verified to contain no remote asset URLs.
- All three legacy stylesheets and per-component custom CSS are deleted by
  the end of the phase; the only theme source is the shadcn token block +
  `.style-maia` overlay. Component styling uses Tailwind utilities and
  shadcn variants — no new `<style>` blocks except where a component
  genuinely needs CSS Tailwind cannot express (e.g. streaming shimmer
  keyframes).
- Because `options.css` is load-bearing for zero-CSS components, the
  options page migrates in one card, not incrementally.

## Consequences

- Supersedes Decision 08 (native Chrome design language) and Decision 18
  (Material Expressive side panel); both marked Superseded.
- New deps: tailwindcss, @tailwindcss/vite, bits-ui, clsx, tailwind-merge,
  @fontsource-variable/figtree, @hugeicons/svelte, @hugeicons/core-free-icons.
- The verify harness's screenshot checks locate UI by accessible name and
  degrade silently to SKIP — each migration card must keep roles/accessible
  names stable or update `verify/checks/screenshots.mjs` in the same card.
- Tailwind's preflight coexists badly with `theme.css`'s element reset
  mid-phase; transitional visual roughness is accepted until the purge card
  removes the legacy sheets.
- The shadcn CLI's behaviour against the CRXJS multi-entry Vite config is
  unverified; the toolchain card trials `init` in a scratch project and
  ports its output rather than trusting in-place patching.

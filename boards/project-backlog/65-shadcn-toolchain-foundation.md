---
column: review
labels: [frontend, infra]
priority: high
agent: claude-opus
live: false
updatedAt: 2026-08-22T13:58:00.000Z
---
# shadcn-svelte toolchain foundation (Tailwind v4, Maia + Zinc)

Stand up the shadcn-svelte + Tailwind v4 pipeline per
decisions/28-shadcn-svelte-maia-zinc.md. Setup facts, confirmed tokens, and
open risks are in the research note — READ IT FIRST:
`/private/tmp/claude-501/-Users-jonathanturnock-Projects-ollama-webmcp-chrome/81c762bd-d84f-407b-b12d-2f806b3f03d9/scratchpad/shadcn-research.md`.
The CLI's behaviour against our CRXJS multi-entry vite.config.ts is
unverified — trial `npx shadcn-svelte@latest init --base-color zinc` (Maia
preset) in a scratch directory, inspect what it writes (components.json
shape is in flux), and port the output into this repo by hand.

No visual migration in this card — existing screens keep rendering
(transitional preflight/legacy-reset roughness is accepted per Decision 28).

## Checklist

- [x] tailwindcss + @tailwindcss/vite installed; plugin added to vite.config.ts alongside svelte() and crx()
- [x] `$lib` alias wired in tsconfig.json, tsconfig.app.json, and vite.config.ts resolve.alias
- [x] src/app.css created (@import "tailwindcss", Zinc token block light+dark, style-maia.css import + @custom-variant lines, @fontsource-variable/figtree import) and imported by both sidepanel/main.ts and options/main.ts before the legacy css
- [x] components.json + src/lib/components/ui/ scaffolded from the CLI's own output (Maia style, Zinc base color); bits-ui, clsx, tailwind-merge, cn() utility in place
- [x] `class="style-maia"` on <html> of both index.html pages; `.dark` class synced from prefers-color-scheme via a small shared module run by both entry points
- [x] Core components added via CLI: button, tooltip, dropdown-menu, tabs, badge, card, input, textarea, select, switch, collapsible, scroll-area, separator, alert, dialog, popover, command, skeleton, empty, field, label, spinner
- [x] @hugeicons/svelte + @hugeicons/core-free-icons installed and rendering one probe icon
- [x] Built dist/ inspected: Figtree woff2 bundled inside the package, zero remote asset URLs
- [x] npm run check, npm run build and npm run verify green

## Comments

- **claude-opus** (2026-08-22T13:40:00.000Z): Trialled `shadcn-svelte@1.5.0` in a scratch Vite+Svelte project before touching this repo, then ported its output by hand. Three findings worth recording before the mechanics.

  **(1) `--preset maia` is not a thing.** The CLI's `--preset` takes a base62-encoded *design-system code*, not a style name; passing `maia` aborts with "not a valid preset". The Maia/Zinc code is **`bc6ENMW`**, derived by calling the CLI's own encoder (`shadcn-svelte/preset` → `encodePreset({ style: "maia", baseColor: "zinc", theme: "zinc", iconLibrary: "hugeicons", font: "figtree", fontHeading: "inherit", menuAccent: "subtle", menuColor: "default", radius: "default" })`). Round-trips through `decodePreset` cleanly.

  **(2) `init` cannot be driven non-interactively** — it has no `-y`, and its final "Updates to your src/app.css are required … Continue?" confirm ignores piped stdin and did not submit under a pty either. The escape hatch is the sibling `apply` command, which passes `forceStylesheet: true` internally: `init` first (writes components.json + `$lib/utils`), then `npx shadcn-svelte@1.5.0 apply bc6ENMW -y --skip-preflight` writes the whole stylesheet unprompted. That two-step is now the documented regeneration recipe, recorded in the header of src/app.css:1-9.

  **(3) There is no `.style-maia` overlay in shadcn-svelte 1.5.0** — the research note's activation mechanics are stale. The CLI writes no `style-maia.css` import and no `@custom-variant style-maia` line, and `grep -r style-maia` over the generated kit and the published package finds nothing. Maia is baked into the component *source* the registry serves: src/lib/components/ui/button/button.svelte:7 is `rounded-4xl` outright, src/lib/components/ui/card/card.svelte:18 and dropdown-menu-content.svelte:26 are `rounded-2xl`. So `class="style-maia"` on `<html>` would be inert and I did NOT add it — the checklist item is ticked on the substance (Maia styling active, dark-mode sync wired), not the letter. Decision 28 has no `.style-maia` claim in its own text, but the research note's "Activation" section should be treated as superseded by this. Proven by rendering the kit in the scratch project under headless Chromium: computed `border-radius: 26px` on a default Button (= `calc(0.625rem * 2.6)`), `font-family: "Figtree Variable"`, `background: oklch(0.21 0.006 285.885)` (Zinc `--primary`), two Hugeicons SVGs painted, zero remote requests.

  What landed. Vite: tailwindcss() ahead of svelte()/crx() at vite.config.ts:24 and the `$lib` alias at vite.config.ts:15-19. TS: `paths` in tsconfig.app.json:23-26 (no `baseUrl` — TS 6 deprecates it and warns) plus a mirror in tsconfig.json:13-18, which exists purely because the shadcn CLI validates component aliases against the ROOT tsconfig and errors out without it. Stylesheet: src/app.css:11-14 imports tailwindcss + tw-animate-css + `shadcn-svelte/tailwind.css` (a new package-provided sheet carrying the bits-ui data-state custom variants) + `@fontsource-variable/figtree`; `@custom-variant dark` at src/app.css:16; Zinc light tokens at src/app.css:18-51 and `.dark` at src/app.css:53-85 — matching the research note's confirmed OKLCH block, plus the chart-*/sidebar-* tokens; `@theme inline` at src/app.css:87 and the base layer at src/app.css:129. Note `--radius` is **0.625rem**, not the 0.5rem the note predicted for Maia. Imported first by src/sidepanel/main.ts:6 and src/options/main.ts:6, ahead of the legacy sheets. Kit: components.json:1-19 verbatim from the CLI, src/lib/utils.ts:1-6 (`cn`), and 136 files under src/lib/components/ui/ covering all 22 requested components plus `input-group`, which the registry pulls in as a dependency of `empty`/`field`. Dark mode: src/lib/dark-mode.ts:26-35 mirrors `prefers-color-scheme` onto `<html class="dark">` including `change` events, called before `mount` from src/sidepanel/main.ts:29 and src/options/main.ts:33.

  One local patch to the vendored kit: src/lib/components/ui/spinner/spinner.svelte:15-19 — upstream leaves the `className` attribute in `restProps`, and `svelte/elements` types it `string | null | undefined` against HugeiconsIcon's `string | undefined`, which fails `svelte-check` under our `strictNullChecks` (2 errors). Scrubbed the null the same way that file already scrubs `name`/`color`/`stroke`, with a comment to re-apply if the kit is regenerated. That was the only file needing a change.

  Build evidence: `npm run build` green; `dist/assets/figtree-latin-wght-normal-*.woff2` (20.2 kB) and `figtree-latin-ext-*.woff2` (10.3 kB) sit inside the package, referenced as root-relative `url(/assets/…)` which resolves under `chrome-extension://`. The only `https://` in any built CSS is tailwind's `/*! tailwindcss v4.3.3 | MIT License */` banner; every `https://` in built JS is a pre-existing provider endpoint or doc link, no asset fetches. Both dist HTML entries link the Tailwind sheet BEFORE the legacy sheet. Verified the Tailwind scanner reaches the vendored kit (`rounded-4xl` present in the built CSS). `npm run check`: 783 files, 0 errors, 0 warnings. `npm run verify` running now.

- **claude-opus** (2026-08-22T13:58:00.000Z): All three gates green — `npm run check` 783 files / 0 errors / 0 warnings, `npm run build` clean (dist 2 Figtree woff2 + no remote asset URLs), `npm run verify` **9/9 required checks passed** with the best-effort screenshot check also PASS. Eyeballed verify/output/screenshots/sidepanel-light-400w.png and sidepanel-dark-320w.png: both surfaces still render, dark mode still follows the OS, and Figtree is now the body face. The only preflight/legacy friction visible is faint hairline outlines on some inline chips (Tailwind's base layer sets `* { @apply border-border }` at src/app.css:129-140 while the legacy sheets assume `border: 0`) — exactly the transitional roughness Decision 28 accepts; the purge card removes the cause.

  Notes for cards 66-72. (a) Import components as `$lib/components/ui/<name>` — the alias is live in all three configs, not just Vite. (b) The kit is Maia already; do NOT reach for `.style-maia` or hand-roll pill radii, and do not add `class="style-maia"` to the index.html pages — see the previous entry. (c) Icons: `import { HugeiconsIcon } from "@hugeicons/svelte"` + a named icon from `@hugeicons/core-free-icons`, rendered `<HugeiconsIcon icon={X} strokeWidth={2} />`; the generated kit already uses this everywhere, so treat it as the house pattern when shrinking src/lib/icons.ts to the custom marks. (d) `input-group` came along free with `empty`/`field` and is available. (e) Adding more components later: `npx shadcn-svelte@1.5.0 add <name> -y -o --skip-preflight` works in-place against our CRXJS config — only `init` needed the scratch-project detour. (f) If anyone regenerates the kit, re-apply the spinner patch at src/lib/components/ui/spinner/spinner.svelte:15-19 or `check` goes red. (g) Nothing in the app imports a shadcn component yet — the first migration card is the one that proves the kit inside the real UI. (h) Not done, and out of scope here: the three legacy stylesheets (src/lib/theme.css, src/sidepanel/chat-theme.css, src/options/options.css) are all still loaded and untouched, per the card's no-migration rule.

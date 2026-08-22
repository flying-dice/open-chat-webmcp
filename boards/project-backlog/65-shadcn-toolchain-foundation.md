---
column: todo
labels: [frontend, infra]
priority: high
updatedAt: 2026-08-22T12:00:00.000Z
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

- [ ] tailwindcss + @tailwindcss/vite installed; plugin added to vite.config.ts alongside svelte() and crx()
- [ ] `$lib` alias wired in tsconfig.json, tsconfig.app.json, and vite.config.ts resolve.alias
- [ ] src/app.css created (@import "tailwindcss", Zinc token block light+dark, style-maia.css import + @custom-variant lines, @fontsource-variable/figtree import) and imported by both sidepanel/main.ts and options/main.ts before the legacy css
- [ ] components.json + src/lib/components/ui/ scaffolded from the CLI's own output (Maia style, Zinc base color); bits-ui, clsx, tailwind-merge, cn() utility in place
- [ ] `class="style-maia"` on <html> of both index.html pages; `.dark` class synced from prefers-color-scheme via a small shared module run by both entry points
- [ ] Core components added via CLI: button, tooltip, dropdown-menu, tabs, badge, card, input, textarea, select, switch, collapsible, scroll-area, separator, alert, dialog, popover, command, skeleton, empty, field, label, spinner
- [ ] @hugeicons/svelte + @hugeicons/core-free-icons installed and rendering one probe icon
- [ ] Built dist/ inspected: Figtree woff2 bundled inside the package, zero remote asset URLs
- [ ] npm run check, npm run build and npm run verify green

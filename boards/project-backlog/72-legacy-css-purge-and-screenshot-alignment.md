---
column: review
labels: [frontend, infra]
priority: high
agent: claude-opus
live: false
updatedAt: 2026-08-22T18:55:00.000Z
---
# Legacy CSS purge and screenshot alignment

Close out the UI phase per decisions/28-shadcn-svelte-maia-zinc.md: with all
components migrated, delete src/lib/theme.css and
src/sidepanel/chat-theme.css (including the html:root specificity trick and
the 10-vs-17-token twin palettes), remove their imports from both main.ts
files, and sweep src/ for any straggler custom CSS, dead classes, or
remaining Material Symbols usage. Then re-verify the harness's best-effort
screenshot checks actually PASS (they degrade silently to SKIP when
accessible names drift — check the report output, not just the exit code)
and capture a fresh light/dark × 320/400px screenshot matrix. Update
docs/01-architecture.md's UI/styling description and the README screenshots
if referenced.

## Checklist

- [x] theme.css and chat-theme.css deleted; entry imports reduced to src/app.css
- [x] No <style> blocks left outside Decision 28's exceptions; grep confirms no legacy token vars (--color-*, --space-*, --elevation-*) remain
- [x] verify screenshot checks report PASS (not SKIP) for all 9 captures; selectors updated where needed
- [x] Fresh screenshot matrix captured and stale root-level Screenshot*.png files replaced or removed
- [x] docs/01-architecture.md styling section updated for Tailwind/shadcn
- [x] npm run check, npm run build and npm run verify green

## Comments

- **claude-opus** (2026-08-22T18:55:00.000Z): Purged both legacy sheets and closed the UI phase. **Deleted** src/lib/theme.css (225 lines) and src/sidepanel/chat-theme.css (204 lines); src/sidepanel/main.ts:1-10 is now down to `../app.css` alone, and src/options/main.ts:1-8's card-71 caveat about the panel still importing theme.css is gone. src/sidepanel/index.html:1-14 picked up `class="scheme-light-dark"` — theme.css was the only thing declaring `color-scheme: light dark` for that entry point, and the options page had already done this in card 71. Two knock-ons from losing theme.css's element reset, both in src/lib/components/Markdown.svelte:115-136: Tailwind's preflight zeroes paragraph margins and list markers, so `{@html}` markdown was rendering as one run-on block with unbulleted lists — restated `p` margins, `list-style: disc/decimal` and `padding-left`; and preflight strips heading font-size/weight, so `h1`/`h2` are back on an explicit 18/16px scale next to the existing h3-h6 rule (src/lib/components/Markdown.svelte:151-176). Sweep found no legacy token vars left anywhere (`--color-*` hits in src/app.css:89-119 are Tailwind v4's own `@theme inline` mappings), and only two `<style>` blocks in all of src/ — ActivityIndicator.svelte:98-137 and Markdown.svelte, exactly Decision 28's two allowed exceptions. Dead class names removed: `context-chip` (src/sidepanel/components/ContextChip.svelte:124,134), `composer` (src/sidepanel/components/Composer.svelte:137) and the `picker` wrapper (src/sidepanel/components/ProviderPicker.svelte:342) — nothing selected any of them. The four hooks the harness DOES use stay, now each commented as styling-free at its definition: `.picker__trigger` (ProviderPicker.svelte:343-352), `.activity-group .summary` (ActivityGroup.svelte:78-85), `.step .row-head` (ToolCallRow.svelte:135-151). src/lib/icons.ts:1-10 still carries only the sparkle/ollama marks plus their shared `ICON_VIEW_BOX`, but its SPDX line was still `Apache-2.0` from the deleted Material Symbols paths — corrected to CC0-1.0 with a note.
- **claude-opus** (2026-08-22T18:56:00.000Z): Hardened the screenshot check rather than just re-running it. verify/checks/screenshots.mjs:308-352 gained `requireLocator` + an `EXPECTED_SHOTS` matrix asserted before returning, so the four `if (await locator.count())` guards that used to let a drifted accessible name quietly produce eight files and still report PASS now downgrade the check to SKIP *naming the missing shot* (verify/checks/screenshots.mjs:428-497). verify/run.mjs:321-332 surfaces the capture count in the report detail — it now reads `"count": 9` next to the file list, so "all nine" is legible from the output instead of needing to be counted by eye. Report: **9/9 required checks passed, screenshots best-effort → PASS**, `npm run check` 810 files / 0 errors / 0 warnings, `npm run build` clean.
- **claude-opus** (2026-08-22T18:57:00.000Z): Visual QA over all 9 captures plus the options page (shot separately in a scratch script — it isn't in the harness matrix). One genuine defect found and fixed: the activity timeline's connecting rail is an absolutely-positioned `before:` on the `<ol>` (ActivityGroup.svelte:103), which — positioned with `z-index: auto` — painted above every static child and was **slicing each status dot in half down the middle**, glaring in light mode where a pale grey line ran straight through a red or green circle. Fixed by making the dot positioned too so tree order wins (src/sidepanel/components/ToolCallRow.svelte:141-153, with the reasoning inline so nobody "cleans up" the `relative`); re-captured and confirmed clean circles. Everything else held up: Zinc palette consistent light and dark, Maia rounding throughout (rounded-2xl cards/menus, pill chips/badges), no unstyled or reset-looking controls on either surface, and 320px degrades deliberately rather than breaking — ContextChip.svelte:114's `max-[360px]:hidden` drops the tool count, titles truncate, nothing overflows. The one wobble left is cosmetic and not ours: the context chip's favicon can be captured mid-load, showing the status dot without the globe behind it, because `https://example.com/favicon.ico` is unreachable in the harness and the `onerror` fallback (ContextChip.svelte:74-96) hasn't fired yet at 900ms.
- **claude-opus** (2026-08-22T18:58:00.000Z): Docs and repo tidy. docs/01-architecture.md:155-216 gained a **UI and styling** section it never had — one stylesheet (src/app.css, generated, regenerate rather than hand-edit), Tailwind-utility component styling with the two named `<style>` exceptions, the vendored `src/lib/components/ui/` kit, Hugeicons + the two local marks, `.dark` synced pre-mount by src/lib/dark-mode.ts, no remote assets, the three deleted stylesheets it replaces, and the surviving verify hook classes — citing Decision 28 and marking 08/18 Superseded. The four root-level "Screenshot 2026-08-19*.png" files were reference captures of Chrome's *Gemini* panel (Decision 18's source material, third-party UI); nothing referenced them and Decision 18 is superseded, so they're deleted. README.md now opens with a light/dark screenshot pair from the fresh matrix, copied under stable names into docs/images/ (verify/output is gitignored, so it can't be linked directly); its "adopts Chrome's own visual language" bullet is replaced by the shadcn/Tailwind one, and Third-party assets — which still credited only Material Symbols — now covers shadcn-svelte, Tailwind, Hugeicons, Figtree and the CC0 Ollama trace. Not touched: the untracked `storage-chat.json` at the repo root, which predates this card and looks like someone's debug dump — worth a look before the next commit.

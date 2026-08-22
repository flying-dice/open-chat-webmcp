# ui — the shared UI layer

Presentation that BOTH Svelte surfaces render through, plus the vendored
shadcn-svelte kit. This folder was `src/lib`, the pre-DDD grab bag
decisions/29 set out to empty; card 78 took the last non-UI module out of it
(`permissions.ts` → `src/infra/chrome-runtime`, `dark-mode.ts` →
`src/infra/dom`) and decisions/33 renamed what was left so the folder names
its layer.

| What | Why it is shared rather than per-surface |
| --- | --- |
| `components/ui/` | the vendored shadcn-svelte kit (decisions/28). Generated source, not our architecture — excluded from both guards, and not an exception to them |
| `utils.ts` | `cn()`, which the kit imports as `$lib/utils` |
| `components/Markdown.svelte`, `markdown.ts` | assistant replies in the panel and provider-fix copy on the options page render the same markdown, with the same streaming tolerance and the same DOMPurify sanitisation |
| `icons.ts` | the inline icon set both surfaces draw from |
| `providerIcon.ts` | maps the preset catalogue's icon KEY (`src/domain/providers`) onto a glyph — card 73 moved this mapping OUT of the domain so restyling a glyph stays a UI-only change |
| `webmcp.d.ts` | ambient `document.modelContext` typings |

## The rules

`shared-ui-is-ui-only` (`.dependency-cruiser.cjs`): this folder may import
`src/domain` and itself, and nothing else. A module here that needs an adapter
wants a prop; one that needs a surface's own module is not shared code and
belongs in that surface.

`$lib` still spells itself `$lib` — that is the shadcn-svelte CLI's convention
and every file of the vendored kit writes it — but the alias points here
(`tsconfig.json`, `tsconfig.app.json`, `vite.config.ts`).

Touching the DOM is fine: that is what UI is. `markdown.ts` calls DOMPurify,
and that does not make it infrastructure.

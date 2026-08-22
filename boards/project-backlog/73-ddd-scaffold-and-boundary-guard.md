---
column: todo
labels: [backend, infra]
priority: high
updatedAt: 2026-08-22T13:00:00.000Z
---
# DDD scaffold and boundary guard

Stand up the ports-and-adapters skeleton from decisions/29-ddd-hexagonal-typescript-layout.md
plus the two guard scripts from decisions/31-clean-code-guard.md;
`.claude/skills/ddd-hexagonal/SKILL.md` is the rulebook for what lives where.
Only about seven of `src/lib`'s eighteen modules are infrastructure-free, so this
card moves ONLY those already pure: `src/lib/provider.ts` (302 lines, the cleanest
module in the tree) → `src/domain/providers`, and `src/lib/mcp/types.ts` (225) +
`src/lib/mcp/merge.ts` (301, imported by 12+ modules) → `src/domain/tools`.
Presentation that rode along in domain modules is stripped on the way:
`capabilityBadge` in `src/lib/providers/capability.ts` (97) and `originLabel` in
`mcp/merge.ts` move to the UI layer, and `src/lib/providers/presets.ts` (219)
stops importing `IconName` from `src/lib/icons.ts`. No behaviour changes — this is
folders, imports and lint rules.

## Checklist

- [ ] `src/domain/{chat,providers,tools,settings}/` and `src/infra/{chrome-storage,ollama,openai,mcp,chrome-runtime,webmcp}/` created, each with an index barrel (contexts still empty at this point get a placeholder plus a one-line README of what lands there)
- [ ] dependency-cruiser installed and configured with the Decision 29 rules: `roots → infra → domain` only, no `src/domain/*` edge to infra/UI/`chrome.*`/`fetch`/Svelte, no cross-surface imports (sidepanel ↔ options), `src/lib/components/ui/` excluded as vendored kit
- [ ] `npm run guard:boundaries`, `npm run guard:clean-code` (scans `src/` for `TODO: clean-code -` in both `//` and `<!-- -->` forms; >0.5 fails with file:line, ≤0.5 reported and allowed) and `npm run guard` (both) wired into package.json
- [ ] `provider.ts` → `src/domain/providers`; `mcp/types.ts` + `mcp/merge.ts` → `src/domain/tools`; every importer updated across sidepanel, options and background
- [ ] `capabilityBadge` and `originLabel` relocated to UI modules — the domain returns codes/enums, the UI maps them to icon and label
- [ ] `presets.ts` carries no icon dependency: the preset catalogue names an icon key, the options UI resolves it against `src/lib/icons.ts`
- [ ] `npm run guard` green on the new tree (boundaries clean; clean-code guard has nothing >0.5 introduced by this card)
- [ ] npm run check, npm run build and npm run verify green

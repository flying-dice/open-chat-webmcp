---
column: review
agent: claude-opus
live: false
labels: [backend, infra]
priority: high
updatedAt: 2026-08-22T21:05:00.000Z
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

- [x] `src/domain/{chat,providers,tools,settings}/` and `src/infra/{chrome-storage,ollama,openai,mcp,chrome-runtime,webmcp}/` created, each with an index barrel (contexts still empty at this point get a placeholder plus a one-line README of what lands there)
- [x] dependency-cruiser installed and configured with the Decision 29 rules: `roots → infra → domain` only, no `src/domain/*` edge to infra/UI/`chrome.*`/`fetch`/Svelte, no cross-surface imports (sidepanel ↔ options), `src/lib/components/ui/` excluded as vendored kit
- [x] `npm run guard:boundaries`, `npm run guard:clean-code` (scans `src/` for `TODO: clean-code -` in both `//` and `<!-- -->` forms; >0.5 fails with file:line, ≤0.5 reported and allowed) and `npm run guard` (both) wired into package.json
- [x] `provider.ts` → `src/domain/providers`; `mcp/types.ts` + `mcp/merge.ts` → `src/domain/tools`; every importer updated across sidepanel, options and background
- [x] `capabilityBadge` and `originLabel` relocated to UI modules — the domain returns codes/enums, the UI maps them to icon and label
- [x] `presets.ts` carries no icon dependency: the preset catalogue names an icon key, the options UI resolves it against `src/lib/icons.ts`
- [x] `npm run guard` green on the new tree (boundaries clean; clean-code guard has nothing >0.5 introduced by this card)
- [x] npm run check, npm run build and npm run verify green

## Comments

- **claude-opus** (2026-08-22T21:05:00.000Z): Scaffold + guards landed; no behaviour change anywhere.

  **Tree.** `src/domain/{chat,providers,tools,settings}` and `src/infra/{chrome-storage,ollama,openai,mcp,chrome-runtime,webmcp}` all exist with an `index.ts` barrel. The eight empty ones carry a README that is a *table* — what lands there, which file it comes from, and what stays behind — so cards 74-79 don't have to re-derive the split (e.g. src/infra/chrome-storage/README.md:9-15 lists all five stores and their storage keys, src/infra/ollama/README.md:9-14 says the `ollama:baseUrl`/`ollama:cap:<model>` persistence does NOT travel with the wire client).

  **Moved (git mv, history intact).** src/lib/provider.ts → src/domain/providers/provider.ts; src/lib/providers/capability.ts → src/domain/providers/capability.ts; src/lib/providers/presets.ts → src/domain/providers/presets.ts; src/lib/mcp/types.ts → src/domain/tools/types.ts; src/lib/mcp/merge.ts → src/domain/tools/merge.ts. 28 importers updated across sidepanel, options and src/lib; every one now imports the context BARREL (`../../domain/providers`, `../../domain/tools`), never a file inside it, and duplicate import statements from the same barrel were merged rather than left doubled (src/options/components/ProvidersSection.svelte:27-36, src/sidepanel/services/mcpTools.ts:36-45). `src/background/sw.ts` and `src/content/relay.ts` needed no edit — they import only `lib/protocol`.

  **Two inward edges cut so the guard could actually be turned on.** (1) `ToolAnnotations`/`SerializedTool` moved out of src/lib/protocol.ts into src/domain/tools/tool.ts:22-57 — both `ChatProvider.chat()` and `toSerializedTools` speak them, so the domain owns the shape and protocol.ts now re-exports it (src/lib/protocol.ts:22-33). Otherwise both domain contexts would have depended on the chrome.runtime messaging adapter. (2) src/domain/tools/merge.ts no longer imports `McpServerConfig` from the `chrome.storage` registry: everything it ever read off a config was `{id, name}`, so it names that minimum itself as `ToolServerIdentity` (src/domain/tools/merge.ts:70-73) and `buildServerMergedTools`/`ServerToolExecutor` are generic over the caller's richer config (merge.ts:209, :232). Inference at the one call site is unchanged — src/sidepanel/services/mcpTools.ts:73-78 needed no edit.

  **Presentation stripped out of domain.** `capabilityBadge` → src/sidepanel/lib/capabilityBadge.ts:19-29 (only consumer: ProviderPicker.svelte); `originLabel` → src/sidepanel/lib/toolOrigin.ts:19-21 (6 consumers incl. agentLoop.ts, which deliberately reaches for the UI wording so the system prompt names an origin in the same words the approval card does — src/sidepanel/services/agentLoop.ts:100-104). `presets.ts` `icon` is now a plain `string` KEY (src/domain/providers/presets.ts:66-75) and `iconForProvider` became `iconKeyForProvider` (presets.ts:222-226); the resolver `iconForProvider` lives at src/lib/providerIcon.ts:47-49 with an explicit key→`IconName` table. Confirmed card 71's finding: PresetPicker.svelte never rendered a preset icon, so the options page needed no change — the one consumer is src/sidepanel/App.svelte:40.

  **Guard.** `npm run guard:boundaries` = `depcruise` + scripts/guard-boundaries.mjs. dependency-cruiser turned out to parse `.svelte` too (verified: it resolves ProviderPicker.svelte's imports down to src/domain/providers/index.ts), so the rules cover components, not just `.ts`. Seven rules enforce TODAY: `domain-is-pure`, `domain-has-no-dependencies` (zero npm deps in the domain), `domain-contexts-meet-at-barrels`, `infra-does-not-import-ui`, `adapters-do-not-import-adapters`, `no-cross-surface-imports`, `no-unresolvable`. `no-circular` is `warn` not `error` — the tree has exactly two cycles and neither is this card's: the real one is the `providers/ollama.ts ⇄ providers/registry.ts` side-effect self-registration decisions/29 calls out (card 79 kills it; promote the rule there), the other is ToolArgValue/SchemaProperty importing themselves, which is just how a Svelte component recurses. Three rules are written out in full but COMMENTED with the card that turns them on (.dependency-cruiser.cjs:173-224): `no-src-lib`, `ui-does-not-import-infra`, `only-roots-construct-infra` — all three would fail today because src/lib still holds nine infra-heavy modules, and a guard that fails on day one is a guard people learn to skip.

  scripts/guard-boundaries.mjs covers what an import lint structurally cannot: `chrome.*`, `fetch(`, `document.`, `window.`, `navigator.`, `localStorage`, `indexedDB`, `XMLHttpRequest` and the Svelte runes are ambient GLOBALS, so a domain module can reach for any of them without an import line and dependency-cruiser would still report a clean graph. It scans src/domain's source text, skipping comment lines (domain modules explain why a concern was pushed out, and saying so must not fail the guard that made it true).

  scripts/guard-clean-code.mjs implements decision 31 verbatim: both `//` and `<!-- -->` forms, >0.5 fails with file:line, ≤0.5 printed as accepted debt, unparseable score fails (a violation nobody can score is a violation nobody can triage). `src/lib/components/ui/` excluded from both guards.

  **Both guards were tested by injecting real violations, not just by passing.** A domain module importing src/lib, importing `marked`, deep-importing another context's file, and calling `chrome.storage` — plus a sidepanel→options cross-import and four markers (0.9, 0.7 in `<!-- -->` form, 0.3, and an unscored one) — produced exactly 4 depcruise errors, 1 purity violation and the right fail/accept/malformed split, `npm run guard` exiting 4. All reverted.

  **Gates.** `npm run guard` green (exit 0; 130 modules, 340 dependencies, 0 errors, the 2 documented warnings). `npm run check` 824 files, 0 errors, 0 warnings. `npm run build` clean. `npm run verify` 9/9 required checks passed, screenshots best-effort PASS. Also wired the guard into .claude/skills/pre-commit/SKILL.md:10 (decision 31 requires it) and pointed .claude/skills/ddd-hexagonal/SKILL.md:117-127 at the config.

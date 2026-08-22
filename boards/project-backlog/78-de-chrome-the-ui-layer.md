---
column: todo
labels: [frontend, backend]
priority: high
updatedAt: 2026-08-22T13:25:00.000Z
---
# De-chrome the UI layer

Components must talk to the domain through injected ports only, per
decisions/29-ddd-hexagonal-typescript-layout.md and the "UI importing
infrastructure directly" smell in `.claude/skills/ddd-hexagonal/SKILL.md`. Seven
of eleven options components call `chrome.*` directly: the worst is
`src/options/McpServerForm.svelte` (728 lines, 498 of them script) with 4
`chrome.identity` calls, 3 storage calls and the entire OAuth sign-in
orchestration inline; `ProvidersSection.svelte` (440) makes 5 permission calls
plus storage behind a header comment that claims it does not. On the side panel,
`App.svelte` reads storage at App.svelte:146 and builds the provider client inline
in `handleSend` (App.svelte:216-258), and two more components reach out directly
(`Header.svelte:16` for `chrome.sidePanel`, `ContextChip.svelte:66`). Two
duplicated re-export shims and a pair of colliding module exports get cleared at
the same time.

## Checklist

- [ ] `src/options/main.ts` becomes a real composition root: it builds the provider registry, MCP registry, host-permissions, MCP auth and history services and passes them to the sections — no options component constructs infra
- [ ] `McpServerForm.svelte` keeps only form state; its 4 `chrome.identity` sites and the whole inline OAuth orchestration move behind an `McpAuthService` port (the flow itself living in `src/infra/mcp`), leaving the component with a sign-in call and a result to render
- [ ] `ProvidersSection.svelte`, `McpServersSection.svelte` (5 permission calls each), `ProviderForm.svelte` and `HistorySection.svelte` call injected services instead of `chrome.permissions` / `chrome.storage`; the false "no chrome here" header comment on ProvidersSection is deleted or made true
- [ ] side panel: the storage read at `src/sidepanel/App.svelte:146` and the inline provider-client construction in `handleSend` (App.svelte:216-258) move to services wired in `src/sidepanel/main.ts`; `Header.svelte:16` (`chrome.sidePanel`) and `ContextChip.svelte:66` get the same treatment
- [ ] the duplicate permission re-export shims `src/lib/mcp/permissions.ts` (9 lines) and `src/options/lib/permissions.ts` (8 lines) are deleted — one permissions adapter under `src/infra/chrome-runtime` wrapping the 7 `chrome.permissions` sites from `src/lib/permissions.ts`
- [ ] `src/options/lib/testResultDisplay.ts` (36) and `src/options/lib/mcpTestResultDisplay.ts` (74) stop exporting colliding names — one module, or names that say which subject they format
- [ ] `grep -rn "chrome\." src/` returns hits only under `src/infra/`, the three composition roots and `src/content/relay.ts`; `npm run guard:boundaries` enforces the same rule
- [ ] npm run check, npm run build, npm run guard and npm run verify green

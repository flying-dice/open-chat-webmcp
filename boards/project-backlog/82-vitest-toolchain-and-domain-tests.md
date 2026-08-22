---
column: todo
labels: [infra, backend]
priority: high
updatedAt: 2026-08-22T13:45:00.000Z
---
# Vitest toolchain and domain tests

Add the unit layer from decisions/30-vitest-test-pyramid.md — the repo has no test
framework at all today, only the Chrome-for-Testing `verify/` harness, which
deliberately bypasses the Svelte UI. Wiring is non-trivial because vite.config.ts
is a multi-entry MV3 build (`svelte()` + `crx({manifest})`) and svelte.config.js
is bare (`export default {}`, no vitePreprocess), so the test config must reuse
the Svelte plugin without letting the CRXJS manifest plugin run. Tests live beside
their modules as `src/domain/**/*.test.ts` and use no platform mocks whatsoever —
that is the payoff of the domain extraction. The richest target is the merge
algebra in `domain/tools` (301 lines, 12+ dependents): namespacing, slug
assignment, truncation and page/server combination.

## Checklist

- [ ] `vitest` (+ `@vitest/coverage-v8`) installed; a vitest config reuses the Svelte plugin but excludes `crx()`, defaults to the `node` environment and picks up `src/**/*.test.ts`
- [ ] `npm test` (single run) and a watch script wired into package.json; a coverage script reporting on `src/domain` and `src/infra`
- [ ] `domain/tools` merge algebra covered hardest: `slugifyServerName` and `assignServerSlugs` collision handling, `namespacedToolName` with `NAMESPACE_SEPARATOR` "__", truncation at `MAX_TOOL_NAME_LENGTH` 64 with the 63/64/65 boundaries, `buildServerMergedTools`, `combineWithPageTools` precedence when a page tool and a server tool share a name, and `toSerializedTools` output shape
- [ ] `domain/chat`: transcript grouping (including the duplicate-group-key case that once crashed the transcript), title derivation, turn-phase transitions, and the session aggregate's message and tool-call append rules — driven over fake ports
- [ ] `domain/providers`: selection resolution, capability resolution (`resolveCapability`, `isSelectable`, `reasonForCapability`) and the `ProviderError` → `describeProviderError` mapping for every variant of the union
- [ ] `domain/settings`: both policies (`"default" | "always-confirm" | "auto-run-all"` and the MCP triple `"always-confirm" | "trust-read-only" | "auto-run-all"`) and the auto-run decision each produces for a read-only vs mutating tool
- [ ] zero platform mocks in domain tests: no `chrome`, `fetch`, DOM or Svelte import under `src/domain` — asserted by construction and by `npm run guard:boundaries`
- [ ] npm run check, npm test, npm run build and npm run verify green

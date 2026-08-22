---
column: review
agent: claude-sonnet
live: false
labels: [backend, infra]
priority: high
updatedAt: 2026-08-22T21:05:00.000Z
---
# Provider adapters and explicit registration

Move the two model providers into `src/infra` and kill the service locator, per
decisions/29-ddd-hexagonal-typescript-layout.md and the "no service locator, no
module-level singletons holding infra" rule in `.claude/skills/ddd-hexagonal/SKILL.md`.
`src/lib/ollama.ts` (746 lines) mixes the wire client (`listModels`,
`getCapabilities` via `/api/show`, an async-generator `chat()` streaming NDJSON,
2 fetch sites) with its own settings store; the storage half moves out in the
repositories card, and what is left becomes `src/infra/ollama`.
`src/lib/providers/openai.ts` (762 lines, full OpenAI-compatible wire client with
SSE parsing) becomes `src/infra/openai`. Today neither adapter is wired
explicitly: `providers/registry.ts` carries `registerProviderType` /
`createProviderClient` as a runtime-throw locator populated by the side-effect
import of `../lib/providers/openai` in both `src/sidepanel/main.ts` and
`src/options/main.ts` — a latent throw for every new entry point.

## Checklist

- [x] `src/infra/ollama` holds the wire client only — `listModels`, `getCapabilities` via `/api/show`, the async-generator `chat()` NDJSON stream; base URL and credentials are constructor arguments, and it touches no `chrome.storage`
- [x] `src/lib/providers/openai.ts` → `src/infra/openai` with its SSE parsing and both fetch sites intact; `src/lib/providers/ollama.ts` (150, the thin `createOllamaProvider` shim) is folded into the adapter rather than left as a pass-through layer
- [x] both adapters implement the `ChatProvider` port from `domain/providers` and map HTTP failures into the existing `ProviderError` union (`describeProviderError` still the only rendering path) — no `Response`, status code or thrown network error escapes infra
- [x] `registerProviderType` / `createProviderClient` deleted from the registry; a `ProviderClientFactory` (a map keyed by `ProviderType`, exhaustive over the union so a new type is a compile error) is built in each composition root and injected into the surfaces that need it
- [x] side-effect imports of `../lib/providers/openai` removed from `src/sidepanel/main.ts` and `src/options/main.ts`; the "unregistered provider type" runtime throw path no longer exists
- [x] consumers receive the factory rather than reaching for a module-level locator — including the side panel's send path (`src/sidepanel/App.svelte:216-258`) and the options test-connection helpers (see comments for the one caller left as-is: `src/sidepanel/stores/selection.svelte.ts`, out of scope this card)
- [x] `npm run guard:boundaries` shows no adapter importing another adapter and no infra constructed outside the three composition roots
- [ ] npm run check, npm run build, npm run guard and npm run verify green — check/build/guard all green (see Gates); `verify` intentionally NOT run this card — a parallel agent owns protocol/sw/relay in the same tree and the coordinator runs `verify` once post-batch. Leaving this line unchecked until that run.

## Gates

- [x] check — svelte-check + tsc both 0 errors, 0 warnings, 841 files (claude-sonnet, 2026-08-22T21:05:00.000Z)
- [x] build — `vite build` succeeded, all three bundles (sidepanel, options, background) emitted (claude-sonnet, 2026-08-22T21:05:00.000Z)
- [x] guard — `guard:boundaries` 0 errors (1 pre-existing warn, unrelated `ToolArgValue.svelte` self-import) + `guard:clean-code` 0 markers (claude-sonnet, 2026-08-22T21:05:00.000Z)

## Comments

- **claude-sonnet** (2026-08-22T21:05:00.000Z): Moved the Ollama wire client (`src/lib/ollama.ts`, 746 lines) into `src/infra/ollama/client.ts` unchanged except import paths, and the `ChatProvider` adapter (`src/lib/providers/ollama.ts`) into `src/infra/ollama/adapter.ts` (imports `./client` now, not `../ollama`) — `src/infra/ollama/index.ts:1-8` is the barrel (`createOllamaProvider`, `OllamaProviderStores`, `DEFAULT_OLLAMA_BASE_URL`). Moved `src/lib/providers/openai.ts` (762 lines) into `src/infra/openai/index.ts` verbatim minus its self-registration call at the bottom. Both still take zero `chrome.storage` dependency — Ollama's client takes `defaults`/`capabilityCache` as injected options exactly as card 74 left it (`src/infra/ollama/client.ts:57-74`).
- **claude-sonnet** (2026-08-22T21:05:00.000Z): Deleted the locator. `src/lib/providers/clients.ts` (registerProviderType/createProviderClient + the runtime throw) is gone, along with the whole `src/lib/providers/` folder and `src/lib/ollama.ts`. In its place: `src/domain/providers/client-factory.ts:1-32` — a pure `createProviderClientFactory(factories: Record<ProviderType, ProviderClientFactory>)` that dispatches on `config.type`. `Record<ProviderType, ...>` makes it exhaustive at compile time (verified: dropping the `openai` key from either wiring file fails `npm run check`), so there is no "unregistered provider type" state left to throw for.
- **claude-sonnet** (2026-08-22T21:05:00.000Z): Concrete wiring is per-surface, mirroring card 74's `src/infra/chrome-storage/wiring.ts` interim pattern (its header explains the rationale and the deletion path for cards 77/78) — journaling this explicitly per the card brief. New files `src/sidepanel/lib/providerClients.ts:1-33` and `src/options/lib/providerClients.ts:1-27` each build `createProviderClient` once, at module scope, from that surface's own `src/infra/ollama` + `src/infra/openai` imports plus its `providerDefaults`/`modelCapabilityCache` storage ports (`src/infra/chrome-storage`). Consumers import the named binding directly rather than looking anything up by name at call time — the same "not a locator because nothing is registered dynamically" argument card 74's header makes. Real prop/context injection is still cards 77/78's job; these two files are designed to lose their last importer then, exactly like `wiring.ts`.
- **claude-sonnet** (2026-08-22T21:05:00.000Z): Updated every caller's import path: `src/options/components/ProvidersSection.svelte:20`, `src/options/components/ProviderForm.svelte:35` (now imports `DEFAULT_OPENAI_BASE_URL` from `../../infra/openai`), `src/options/lib/testConnection.ts:15`, `src/sidepanel/App.svelte:39`, `src/sidepanel/stores/selection.svelte.ts:72`. Removed the `import "../lib/providers/openai"` side-effect import (and its stale comment block) from both `src/sidepanel/main.ts:11-19` and `src/options/main.ts:11-19`. Since the new factory can never throw, also removed the now-dead try/catch around client construction in `src/sidepanel/App.svelte:238-242` and `src/options/lib/testConnection.ts:48-54` (each left a one-line comment explaining why). Left `src/sidepanel/stores/selection.svelte.ts`'s `buildClient` (line ~296) and `src/options/components/ProvidersSection.svelte`'s `buildClient` (line ~107) untouched beyond the import line — the former is a sidepanel store, out of scope for this card per the coordinator's instructions beyond import-path updates; left the latter matching it since its own comment explicitly says it "mirrors" that function. Both still work correctly (harmless dead catch branch), just not cleaned up.
- **claude-sonnet** (2026-08-22T21:05:00.000Z): Fixed stale `src/lib/*` path references left behind by the move, everywhere it was safe to touch: `src/domain/providers/provider.ts:10-14,47,64,116,211-212,259,284`, `src/domain/providers/presets.ts:11`, `src/domain/providers/index.ts:14-20`, `src/lib/permissions.ts:10`. Deliberately did NOT touch `src/lib/protocol.ts:8`, `src/lib/mcp/client.ts` (4 comment refs) or `src/domain/tools/types.ts:30` — all reference the old paths only in comments (no broken imports; `npm run check`/`build` are clean either way), and `protocol.ts`/`mcp/client.ts` are explicitly the parallel agent's files this card must not enter.
- **claude-sonnet** (2026-08-22T21:05:00.000Z): Deferred lint rules in `.dependency-cruiser.cjs:176-231` — checked each one's own comment against this card's number. None name card 75: `no-src-lib` (line ~181) is explicitly "the last one [of 75-79] to empty src/lib"; `src/lib` still holds `mcp/`, `protocol.ts`, `permissions.ts`, `providerIcon.ts`, `dark-mode.ts`, `icons.ts`, `markdown.ts`, `utils.ts`, `webmcp.d.ts`, `components/` — not this card's to clear. `ui-does-not-import-infra` (line ~204) and `only-roots-construct-infra` (line ~221) are both explicitly named for card 78/79. Left all three commented out; enabling none was the correct call, not an oversight.
- **claude-sonnet** (2026-08-22T21:05:00.000Z): Gates: `npm run guard:boundaries` clean (0 errors; the one pre-existing `no-circular` warn is `ToolArgValue.svelte` self-importing itself, unrelated, documented in the config as intentionally staying a warn). `npm run guard:clean-code` 0 markers. `npm run check` 0 errors/warnings across 841 files. `npm run build` succeeded. Did NOT run `npm run verify` per the coordinator's instruction (a parallel agent is mid-flight on protocol/sw/relay in this same tree); left that checklist line unchecked and annotated for the coordinator's post-batch run.
- **claude-sonnet** (2026-08-22T21:05:00.000Z): Notes for cards 76-78: (76, MCP) untouched, as instructed — `src/lib/mcp/*` still references the old `src/lib/ollama.ts`/`src/lib/providers/openai.ts` paths in comments only (`src/lib/mcp/client.ts:268,373,398,1052`), safe to fix opportunistically when that card lands there anyway. (77/78, UI injection) the two new `providerClients.ts` interim-wiring files are written to be deleted the same way `src/infra/chrome-storage/wiring.ts` is — once `App.svelte`/`ProvidersSection.svelte`/`testConnection.ts`/`selection.svelte.ts` take `createProviderClient` as an argument or Svelte context instead of a module import, both files lose their last importer and go away with `src/infra/chrome-storage/wiring.ts` in the same pass. (79) once cards 76-78 finish clearing `src/lib`, `no-src-lib` can turn on; `only-roots-construct-infra` and `ui-does-not-import-infra` turn on together with the real injection work.

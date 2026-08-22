---
column: todo
labels: [backend, infra]
priority: high
updatedAt: 2026-08-22T13:10:00.000Z
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

- [ ] `src/infra/ollama` holds the wire client only — `listModels`, `getCapabilities` via `/api/show`, the async-generator `chat()` NDJSON stream; base URL and credentials are constructor arguments, and it touches no `chrome.storage`
- [ ] `src/lib/providers/openai.ts` → `src/infra/openai` with its SSE parsing and both fetch sites intact; `src/lib/providers/ollama.ts` (150, the thin `createOllamaProvider` shim) is folded into the adapter rather than left as a pass-through layer
- [ ] both adapters implement the `ChatProvider` port from `domain/providers` and map HTTP failures into the existing `ProviderError` union (`describeProviderError` still the only rendering path) — no `Response`, status code or thrown network error escapes infra
- [ ] `registerProviderType` / `createProviderClient` deleted from the registry; a `ProviderClientFactory` (a map keyed by `ProviderType`, exhaustive over the union so a new type is a compile error) is built in each composition root and injected into the surfaces that need it
- [ ] side-effect imports of `../lib/providers/openai` removed from `src/sidepanel/main.ts` and `src/options/main.ts`; the "unregistered provider type" runtime throw path no longer exists
- [ ] consumers receive the factory rather than reaching for a module-level locator — including the side panel's send path (`src/sidepanel/App.svelte:216-258`) and the options test-connection helpers
- [ ] `npm run guard:boundaries` shows no adapter importing another adapter and no infra constructed outside the three composition roots
- [ ] npm run check, npm run build, npm run guard and npm run verify green

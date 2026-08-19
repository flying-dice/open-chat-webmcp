---
column: todo
labels: [frontend, backend]
priority: high
updatedAt: 2026-08-20T09:00:00.000Z
---
# Predefined backend presets and a "pick a backend" add flow

Adding a provider currently asks for a base URL, type, name, key and headers —
the right floor, a poor front door. Every hosted backend is the same three facts
(base URL, auth shape, where to get a key) and the user supplies all three from
memory.

See [decisions/21](../../decisions/21-provider-presets.md).

## Scope

**New `src/lib/providers/presets.ts`** — static data only, no behaviour:

```ts
interface ProviderPreset {
  id: string; label: string; type: ProviderType; baseUrl: string;
  requiresKey: boolean; local: boolean; docsUrl: string; note?: string;
}
```

Catalog: Ollama, LM Studio, llama.cpp (local, no key); OpenAI, Anthropic, Google
Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together; plus Custom
(OpenAI-compatible). Azure OpenAI is deliberately out — see decisions/21.

**Verify every base URL against the provider's current documentation before
committing it.** These move, and a wrong one produces a confusing
`unreachable-or-cors` failure that looks like a user mistake. Do not copy them
from memory or from this card without checking.

**`ProviderConfig` gains `presetId?: string`** (`src/lib/providers/registry.ts`).
Absence means Custom — that is a valid state for every already-stored provider,
so do NOT write a migration.

**Options add-flow** (`ProviderForm.svelte`, `ProvidersSection.svelte`,
`ProviderRow.svelte`): choosing a backend first, then a form pre-filled from the
preset showing only what that backend needs — usually just the key. Local presets
ask for no key at all. Every field stays editable; a preset is a starting point,
not a constraint. `ProviderRow` labels a provider by its backend.

Keep the existing host-permission request on save (decision 10) exactly as it
is — a preset does not grant permission, and `requestHostPermission` still needs
its user gesture.

Reuse what card 41 built: `src/lib/providers/capability.ts` for the
tool-capability rule and the "Set as default" guard, and the existing
`mcpTestConnection`-style test-connection affordance if one fits. Do not add a
second copy of either.

## Checklist

- [ ] `presets.ts` catalog, every base URL verified against current docs
- [ ] `presetId` on `ProviderConfig`; absence treated as Custom, no migration
- [ ] Add flow: pick backend, then a form asking only for what it needs
- [ ] Local presets ask for no key; hosted ones link to where to get one
- [ ] Every prefilled field still editable
- [ ] `ProviderRow` shows which backend a provider is
- [ ] Existing stored providers still load, edit and save unchanged

## Comments

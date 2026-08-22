// `ollama` adapter (card 75, decisions/29, decisions/32) — see ./README.md
// for what lands here and from where. Only a composition root or its
// interim per-surface wiring (src/sidepanel/lib/providerClients.ts,
// src/options/lib/providerClients.ts) imports this barrel; the domain sees
// the `ChatProvider` port (src/domain/providers), never this adapter.

export { createOllamaProvider, type OllamaProviderStores } from "./adapter";
export { DEFAULT_OLLAMA_BASE_URL } from "./client";

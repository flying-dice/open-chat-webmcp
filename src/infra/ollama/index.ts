// `ollama` adapter (card 75, decisions/29, decisions/32) — see ./README.md
// for what lands here and from where. Only a composition root or its
// each composition root's `createProviderClientFactory` map
// (src/sidepanel/main.ts, src/options/main.ts) imports this barrel; the domain sees
// the `ChatProvider` port (src/domain/providers), never this adapter.

export { createOllamaProvider, type OllamaProviderStores } from "./adapter";
export { DEFAULT_OLLAMA_BASE_URL } from "./client";

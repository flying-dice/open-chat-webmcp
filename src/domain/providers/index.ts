// `providers` bounded context (decisions/29-ddd-hexagonal-typescript-layout.md):
// the provider-agnostic chat contract (`ChatProvider` and its error
// vocabulary), the tool-capability policy every surface must agree on
// (decisions/11), and the static catalogue of predefined backends
// (decisions/21).
//
// Pure TypeScript — no `chrome.*`, no `fetch`, no DOM, no Svelte. The wire
// clients that IMPLEMENT `ChatProvider` (Ollama, OpenAI-compatible) and the
// `chrome.storage` repository that persists provider configs are adapters
// (src/infra/ollama, src/infra/openai, src/infra/chrome-storage) and land
// there in cards 74-79; `provider.ts` is the port they will implement.
//
// This barrel is the context's public face: other contexts and the outer
// layers import `src/domain/providers`, never a file inside it.

export * from "./provider";
export * from "./capability";
export * from "./presets";

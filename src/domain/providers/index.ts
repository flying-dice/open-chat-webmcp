// `providers` bounded context (decisions/29-ddd-hexagonal-typescript-layout.md):
// the provider-agnostic chat contract (`ChatProvider` and its error
// vocabulary), the tool-capability policy every surface must agree on
// (decisions/11), and the static catalogue of predefined backends
// (decisions/21).
//
// Card 74 added the driven side: `ProviderRegistry` (the configured-provider
// CRUD and the default selection, with `resolveSelection`'s tri-state
// dangling detection as a domain rule over it) plus the two small ports that
// were src/lib/ollama.ts's private storage side-door — `ProviderDefaultsStore`
// and `ModelCapabilityCache`.
//
// Pure TypeScript — no `chrome.*`, no `fetch`, no DOM, no Svelte. The wire
// clients that IMPLEMENT `ChatProvider` (Ollama, OpenAI-compatible) are
// adapters (src/infra/ollama, src/infra/openai, landed by card 75); the
// `chrome.storage` implementations of the ports above already live in
// src/infra/chrome-storage. Card 75 also added `client-factory.ts`: the
// exhaustive `ProviderType -> ChatProvider factory` dispatcher that
// replaced the old `registerProviderType`/`createProviderClient` runtime
// locator (src/lib/providers/clients.ts, deleted).
//
// This barrel is the context's public face: other contexts and the outer
// layers import `src/domain/providers`, never a file inside it.

export * from "./provider";
export * from "./capability";
export * from "./presets";
export * from "./registry";
export * from "./config-store";
export * from "./client-factory";

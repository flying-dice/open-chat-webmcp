// Provider-CLIENT construction: dispatch a `ProviderConfig` to the
// `ChatProvider` factory registered for its `type`.
//
// This is what is left of the old `src/lib/providers/registry.ts` after card
// 74 took its storage away. That module was three things at once
// (decisions/29): a repository, a selection resolver, and this service
// locator. The repository is now `src/infra/chrome-storage/provider-registry.ts`
// behind the `ProviderRegistry` port, the resolver is
// `resolveSelection`/`resolveProvider` in `src/domain/providers`, and the
// file is renamed so its remaining job is what its name says.
//
// The locator itself is a KNOWN inversion and is card 79's to remove:
// `createProviderClient` throws at runtime for a type nobody registered, and
// what registers a type today is an import side effect (`src/lib/providers/openai.ts`
// calls `registerProviderType` at the bottom of itself, and each entry point
// imports that module for no other reason), so a new entry point that forgets
// the import gets the throw. Card 79 replaces both halves with explicit
// wiring in each composition root. Until then this stays where it is, minus
// the storage it used to be tangled with.

import type { ChatProvider, ProviderConfig, ProviderType } from "../../domain/providers";
import { modelCapabilityCache, providerDefaults } from "../../infra/chrome-storage";
import { createOllamaProvider } from "./ollama";

type ProviderFactory = (config: ProviderConfig) => ChatProvider;

const factories = new Map<ProviderType, ProviderFactory>();

/** Register the client factory for a provider type. Ollama's is registered at the bottom of this module; OpenAI's registers itself from `src/lib/providers/openai.ts`. */
export function registerProviderType(type: ProviderType, factory: ProviderFactory): void {
  factories.set(type, factory);
}

/**
 * Build a `ChatProvider` client bound to a resolved config. Throws if `type`
 * has no registered factory — unlike the rest of the provider surface,
 * that's a programming-error path (a provider type whose client was never
 * registered), not a runtime/network failure, so it doesn't go through
 * `ProviderResult`.
 */
export function createProviderClient(config: ProviderConfig): ChatProvider {
  const factory = factories.get(config.type);
  if (!factory) {
    throw new Error(`No client registered for provider type "${config.type}".`);
  }
  return factory(config);
}

// The Ollama client needs two storage ports (its capability cache and the
// fallback base URL it used to reach for `chrome.storage.local` to get, card
// 74). Supplying them HERE, at the registration site, is what keeps
// src/lib/ollama.ts free of storage entirely — card 75 moves that module to
// src/infra/ollama, where importing another adapter would break
// `adapters-do-not-import-adapters`, so it must arrive there already
// injected rather than reaching for a store itself.
registerProviderType("ollama", (config) =>
  createOllamaProvider(config, {
    capabilityCache: modelCapabilityCache,
    defaults: providerDefaults,
  }),
);

// Provider-CLIENT dispatch (card 75, decisions/29): which `ChatProvider`
// factory to use for a resolved config's `type`. Pure indirection — the
// concrete factories (Ollama's and OpenAI's wire clients,
// src/infra/ollama, src/infra/openai) are supplied by whichever
// composition-root wiring builds them; this file never imports either, so
// it stays as infrastructure-free as the rest of this bounded context.
//
// This replaces the old `registerProviderType`/`createProviderClient`
// runtime locator in the deleted src/lib/providers/clients.ts, which threw
// at runtime for a provider type nobody had registered (a latent throw a
// new entry point could hit by forgetting a side-effect import). `Record<
// ProviderType, ProviderClientFactory>` makes the map exhaustive instead:
// TypeScript refuses to compile a `factories` object missing an entry for a
// `ProviderType` member, so adding a third provider type is a compile error
// here, not a runtime throw.

import type { ChatProvider, ProviderType } from "./provider";
import type { ProviderConfig } from "./registry";

/** Builds a `ChatProvider` bound to one resolved config. */
export type ProviderClientFactory = (config: ProviderConfig) => ChatProvider;

/** One `ChatProvider` factory per provider type — exhaustive over {@link ProviderType}. */
export type ProviderClientFactories = Record<ProviderType, ProviderClientFactory>;

/**
 * Build the dispatcher a surface calls to construct a `ChatProvider` for a
 * resolved config, from the concrete factories a composition root supplies.
 * Total over `ProviderType` by construction — there is no "unregistered
 * type" state left to handle.
 */
export function createProviderClientFactory(
  factories: ProviderClientFactories,
): ProviderClientFactory {
  return (config) => factories[config.type](config);
}

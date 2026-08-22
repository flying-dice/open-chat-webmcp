// INTERIM WIRING (card 75) — the options-page twin of
// src/sidepanel/lib/providerClients.ts; read that file's header for the
// full rationale (mirrors src/infra/chrome-storage/wiring.ts's pattern from
// card 74).
//
// The old `registerProviderType`/`createProviderClient` locator
// (src/lib/providers/clients.ts, deleted) is gone. In its place: an
// exhaustive `Record<ProviderType, ...>` built here with this surface's
// concrete adapters and storage ports, exported as a plain binding for
// src/options/components/ProvidersSection.svelte and
// src/options/lib/testConnection.ts.

import { createOllamaProvider } from "../../infra/ollama";
import { createOpenAiProvider } from "../../infra/openai";
import { modelCapabilityCache, providerDefaults } from "../../infra/chrome-storage";
import { createProviderClientFactory } from "../../domain/providers";

/** This surface's `ProviderConfig -> ChatProvider` dispatcher — total over `ProviderType`, never throws for an unknown type. */
export const createProviderClient = createProviderClientFactory({
  ollama: (config) =>
    createOllamaProvider(config, {
      capabilityCache: modelCapabilityCache,
      defaults: providerDefaults,
    }),
  openai: createOpenAiProvider,
});

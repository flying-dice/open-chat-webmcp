// INTERIM WIRING (card 75, mirroring src/infra/chrome-storage/wiring.ts's
// header) — read that file first if you haven't.
//
// The old `registerProviderType`/`createProviderClient` locator
// (src/lib/providers/clients.ts, deleted) is gone. In its place: an
// exhaustive `Record<ProviderType, ...>` (src/domain/providers/client-factory.ts's
// `createProviderClientFactory`), built HERE with this surface's concrete
// adapters (src/infra/ollama, src/infra/openai) and its own storage ports
// (src/infra/chrome-storage), then exported as a plain binding.
//
// Why a module-level export rather than threading this through props: the
// callers today (src/sidepanel/App.svelte, src/sidepanel/stores/selection.svelte.ts)
// take no dependencies at all, the same situation card 74 found with the
// storage ports. Real injection is card 77/78's UI work. This file is the
// same deliberate, easy-to-delete shortcut, scoped to one surface's bundle
// so `no-cross-surface-imports` never has anything to say about it.
//
// HOW A LATER CARD DELETES THIS: once App.svelte/selection.svelte.ts take
// `createProviderClient` as an argument (or Svelte context) instead of
// importing it, src/sidepanel/main.ts builds the factory itself (the same
// three lines below) and passes it down; this file loses its last importer.

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

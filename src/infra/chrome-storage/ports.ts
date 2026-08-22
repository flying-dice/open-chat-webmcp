// The bundle of storage ports a composition root builds (card 74).
//
// One function, one call, six ports — rather than six factories a root has
// to remember to call and keep in step. The two area gateways are created
// once and shared, which is also what makes the credential split visible in
// one place: `sync` and `local` are passed to each repository explicitly, so
// "which area does this key live in" is an argument at the wiring site, not
// a string buried in a module.

import type { ChatStore } from "../../domain/chat";
import type {
  ModelCapabilityCache,
  ProviderDefaultsStore,
  ProviderRegistry,
} from "../../domain/providers";
import type { SettingsStore } from "../../domain/settings";
import type { McpServerRegistry } from "../../domain/tools";
import { createStorageAreaGateway } from "./area";
import { createChromeStorageChatStore } from "./chat-store";
import { createChromeStorageMcpServerRegistry } from "./mcp-server-registry";
import {
  createChromeStorageModelCapabilityCache,
  createChromeStorageProviderDefaultsStore,
} from "./provider-config-store";
import { createChromeStorageProviderRegistry } from "./provider-registry";
import { createChromeStorageSettingsStore } from "./settings-store";

export interface ChromeStoragePorts {
  chatStore: ChatStore;
  providerRegistry: ProviderRegistry;
  mcpServerRegistry: McpServerRegistry;
  settingsStore: SettingsStore;
  providerDefaults: ProviderDefaultsStore;
  modelCapabilityCache: ModelCapabilityCache;
}

/**
 * Build every `chrome.storage`-backed port for one runtime surface.
 *
 * The returned `chatStore` owns per-surface mutable state (its debounced
 * write map and its index-write queue), so calling this twice in one surface
 * would give two stores that do not serialize against each other — exactly
 * the interleaving card 55 fixed. One call per surface; see ./wiring.ts for
 * how that is currently guaranteed.
 */
export function createChromeStoragePorts(): ChromeStoragePorts {
  const local = createStorageAreaGateway("local");
  const sync = createStorageAreaGateway("sync");

  return {
    chatStore: createChromeStorageChatStore(local),
    providerRegistry: createChromeStorageProviderRegistry(sync, local),
    mcpServerRegistry: createChromeStorageMcpServerRegistry(sync, local),
    settingsStore: createChromeStorageSettingsStore(sync),
    providerDefaults: createChromeStorageProviderDefaultsStore(local),
    modelCapabilityCache: createChromeStorageModelCapabilityCache(local),
  };
}

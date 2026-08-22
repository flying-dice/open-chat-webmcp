// `chrome-storage` adapter — the `chrome.storage` side of every driven
// storage port (card 74; see ./README.md). Nothing outside this folder
// touches `chrome.storage` any more, with the two exceptions cards 76 and 77
// own (src/lib/mcp/oauth.ts's token write goes through the registry port
// already; src/sidepanel/stores/panel.svelte.ts's debug flag is card 77's).
//
// What is here:
//   ./area.ts                  the only place `chrome.storage` is called,
//                              and the only place its failures are mapped
//                              into `StorageError`
//   ./keyed-record-store.ts    the ONE list-in-sync + credentials-in-local
//                              mechanic both registries configure
//   ./provider-registry.ts     `ProviderRegistry`      (src/domain/providers)
//   ./mcp-server-registry.ts   `McpServerRegistry`     (src/domain/tools)
//   ./chat-store.ts            `ChatStore`             (src/domain/chat)
//   ./settings-store.ts        `SettingsStore`         (src/domain/settings)
//   ./provider-config-store.ts `ProviderDefaultsStore` + `ModelCapabilityCache`
//   ./ports.ts                 the bundle a composition root builds
//
// A composition root builds the bundle (`createChromeStoragePorts`) and the
// interim `./wiring.ts` holds the one every surface shares until cards 77-79
// finish threading them through as arguments.

export { createStorageAreaGateway, type StorageAreaGateway, type StorageAreaName } from "./area";
export { createChromeStorageChatStore } from "./chat-store";
export { createChromeStorageProviderRegistry } from "./provider-registry";
export { createChromeStorageMcpServerRegistry } from "./mcp-server-registry";
export { createChromeStorageSettingsStore } from "./settings-store";
export {
  createChromeStorageModelCapabilityCache,
  createChromeStorageProviderDefaultsStore,
} from "./provider-config-store";
export { createChromeStoragePorts, type ChromeStoragePorts } from "./ports";
export {
  chatStore,
  initChromeStorage,
  mcpServerRegistry,
  modelCapabilityCache,
  providerDefaults,
  providerRegistry,
  settingsStore,
} from "./wiring";

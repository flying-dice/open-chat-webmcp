// `chrome-storage` adapter — the `chrome.storage` side of every driven
// storage port (cards 74, 76 and 77; see ./README.md). Nothing outside this
// folder touches `chrome.storage` any more, with NO exceptions: card 77 took
// the last one (the panel store's `debug:tab-sync-tracing` flag, now
// ./debug-flags.ts) and deleted its entry from the containment scan in
// scripts/guard-boundaries.mjs.
//
// What is here:
//   ./area.ts                  the only place `chrome.storage` is called,
//                              and the only place its failures are mapped
//                              into `StorageError`
//   ./keyed-record-store.ts    the ONE list-in-sync + credentials-in-local
//                              mechanic both registries configure
//   ./provider-registry.ts     `ProviderRegistry`      (src/domain/providers)
//   ./mcp-server-registry.ts   `McpServerRegistry`     (src/domain/tools)
//   ./mcp-auth-token-store.ts  `McpAuthTokenStore`     (src/domain/tools) —
//                              the write-only narrowing of that registry the
//                              MCP OAuth adapter refreshes tokens through
//   ./chat-store.ts            `ChatStore`             (src/domain/chat)
//   ./settings-store.ts        `SettingsStore`         (src/domain/settings)
//   ./provider-config-store.ts `ProviderDefaultsStore` + `ModelCapabilityCache`
//   ./debug-flags.ts           the sync-path tracing switch — not a port, but
//                              `chrome.storage`, so it lives here
//   ./ports.ts                 the bundle a composition root builds
//
// A composition root — and, since card 78, ONLY a composition root — builds
// the bundle with `createChromeStoragePorts()` and hands the ports it needs to
// its surface's UI. Card 74's interim `./wiring.ts`, the module-level bundle
// that let a component import `providerRegistry` by name while the UI still
// took no dependencies, is gone with its last importer.

export { createStorageAreaGateway, type StorageAreaGateway, type StorageAreaName } from "./area";
export { createChromeStorageChatStore } from "./chat-store";
export { createChromeStorageProviderRegistry } from "./provider-registry";
export { createChromeStorageMcpServerRegistry } from "./mcp-server-registry";
export { createChromeStorageMcpAuthTokenStore } from "./mcp-auth-token-store";
export { createChromeStorageSettingsStore } from "./settings-store";
export {
  createChromeStorageModelCapabilityCache,
  createChromeStorageProviderDefaultsStore,
} from "./provider-config-store";
export { createTracingFlag, type DebugFlag } from "./debug-flags";
export { createChromeStoragePorts, type ChromeStoragePorts } from "./ports";

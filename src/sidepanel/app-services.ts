// The side panel's services, as this surface's UI sees them (card 78).
//
// WHAT THIS IS. Cards 74-76 each left an "interim wiring" module behind —
// src/infra/chrome-storage/wiring.ts and the two
// src/sidepanel/lib/{providerClients,mcpClients}.ts — where a UI module
// imported a CONSTRUCTED ADAPTER by name. That is the shape
// `ui-does-not-import-infra` exists to forbid, and card 78 deletes all three.
// This file replaces them, and the difference is the whole point:
//
//   - every field below is typed by a DOMAIN port or by a small interface
//     declared here. This module imports nothing from src/infra, so neither
//     does anything that imports it.
//   - it CONSTRUCTS nothing. `src/sidepanel/main.ts` — the composition root —
//     builds every adapter once and calls {@link initSidePanelServices}
//     before `mount(App)`. Swapping an implementation is still a one-line
//     change in the root, which is what `only-roots-construct-infra` keeps
//     true.
//
// WHY A MODULE RATHER THAN PROPS OR CONTEXT. The consumers are three Svelte 5
// rune stores, two services and a handful of components, most of them not in
// the component tree's data path at all (a store initialised at import time
// cannot receive a prop). Threading ten ports through ~25 components to reach
// six of them would obscure far more than it revealed. The composition root
// still owns construction and lifetime; this is the hand-off, not a registry.
//
// WHY NOT A SERVICE LOCATOR. Nothing registers into it, nothing is looked up
// by string, and the surface is a single fixed interface the compiler checks
// — a missing service is a type error at the root, not a runtime `undefined`
// at the call site. What it does give up, honestly, is import-graph
// granularity: the guard can see that a store depends on "the side panel's
// services", not on `ChatStore` specifically. That trade is why the globals
// scan in scripts/guard-boundaries.mjs matters as much as the import lint.

import type { Result } from "../domain/result";
import type { StorageError } from "../domain/storage";
import type { ChatService, ChatStore } from "../domain/chat";
import type { HostPermissions } from "../domain/permissions";
import type { ProviderClientFactory, ProviderRegistry } from "../domain/providers";
import type { SettingsStore } from "../domain/settings";
import type {
  McpServerRegistry,
  McpToolGateway,
  PageToolExecutor,
  SerializedTool,
} from "../domain/tools";

/**
 * The active tab's WebMCP tools, and how to call one. Both halves are the
 * background worker's registry seen from here (src/infra/chrome-runtime), and
 * both are per-tab, so this is the shape a turn's `ToolExecutor` is assembled
 * from (src/sidepanel/services/chatTurn.ts).
 */
export interface PageToolAccess {
  /** Whatever tools `tabId` currently publishes. Never rejects — an unreachable worker degrades to an empty list. */
  toolsForTab(tabId: number): Promise<SerializedTool[]>;
  /** A `PageToolExecutor` (src/domain/tools) bound to one tab. */
  executorForTab(tabId: number): PageToolExecutor;
}

/** What a UI surface may ask of the extension's own chrome — see src/infra/chrome-runtime/extension-shell.ts. */
export interface ExtensionShellAccess {
  openOptionsPage(): void;
}

/**
 * The sync-path tracing switch (card 59, card 77's
 * src/infra/chrome-storage/debug-flags.ts). NOT a domain port — it is stored
 * state that exists only to make a diagnosis possible in a real installed
 * build — but the panel's `window.__webmcpPanelDebug` snapshot both reports
 * and toggles it, so the surface needs the two methods and nothing else.
 */
export interface TracingSwitch {
  isEnabled(): boolean;
  /** Card 92: the write's `Result` reaches the devtools console the toggle is typed into, rather than being swallowed here — a "why is tracing still off" that turns out to be a storage failure should say so at the prompt. */
  set(enabled: boolean): Promise<Result<void, StorageError>>;
}

export interface SidePanelServices {
  /** Everything that can be DONE to a conversation (src/domain/chat). Built by the root from the chat store, this panel's presenter and the approval-policy gate. */
  chat: ChatService;
  /** Chat PERSISTENCE, for the two read-only history surfaces (HistoryPanel, the overflow menu's recent list) and deletion. Distinct from `chat` on purpose: listing and deleting past chats is not something done to the CURRENT conversation. */
  chats: ChatStore;
  providers: ProviderRegistry;
  createProviderClient: ProviderClientFactory;
  settings: SettingsStore;
  mcpServers: McpServerRegistry;
  mcpTools: McpToolGateway;
  permissions: HostPermissions;
  pageTools: PageToolAccess;
  shell: ExtensionShellAccess;
  tracing: TracingSwitch;
}

// TODO: clean-code - 0.3 - DRY: this module-singleton "init once, throw if already set / throw if read before init" pair is identical logic duplicated in src/options/app-services.ts — extractable as one generic createServiceSlot<T>(). STAYS: there is no layer both surfaces may share for it. src/ui is the shared UI layer (components and copy), not a place for a service locator, and a composition-root helper in src/domain would be an outward dependency the boundaries guard exists to prevent. The duplicated part is also the part with a THROW in it (guard:throws allows these two files by name), so moving it moves an allowlist entry too. Ten lines, twice, with a guard watching both.
// TODO: clean-code - 0.15 - COUPLING: the initXServices()/xServices() module-singleton pair is a documented, deliberate service-locator substitute for props/context; every consumer checked either destructures immediately or calls one member, so the hazard this pattern invites (re-widening the whole bundle) has not materialized in practice.
let current: SidePanelServices | undefined;

/**
 * Called ONCE by src/sidepanel/main.ts, before `mount(App)`. Calling it twice
 * is a wiring bug — two chat stores in one surface would each hold their own
 * debounce map and index-write queue and stop serializing against each other
 * (the interleaving card 55 fixed) — so it throws rather than quietly
 * replacing what is already there.
 */
export function initSidePanelServices(services: SidePanelServices): void {
  if (current) {
    throw new Error(
      "[webmcp] side panel services were already initialised — main.ts wires them once.",
    );
  }
  current = services;
}

/**
 * The wired services. Throws if the root has not run — which can only happen
 * from a module imported outside `src/sidepanel/main.ts`'s graph, and is far
 * better than the `undefined` port it would otherwise hand back.
 */
export function sidePanelServices(): SidePanelServices {
  if (!current) {
    throw new Error(
      "[webmcp] side panel services are not initialised — src/sidepanel/main.ts must run first.",
    );
  }
  return current;
}

/** Shorthand for the one service nearly every caller wants. Reads as it did before card 78, when this was a module-level `const` in the panel store. */
export function chat(): ChatService {
  return sidePanelServices().chat;
}

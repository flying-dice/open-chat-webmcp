// The options page's services, as this surface's UI sees them (card 78) —
// the twin of src/sidepanel/app-services.ts; read that file's header for why
// this shape rather than props, context, or the interim wiring modules cards
// 74-76 left behind (all three now deleted).
//
// This surface is the one decisions/29 singled out: seven of its eleven
// components called `chrome.*` directly, the worst of them
// McpServerForm.svelte with four `chrome.identity` sites and the whole OAuth
// sign-in orchestration inline. Every one of those calls is now a port
// below — `permissions` for the five `chrome.permissions` sites in the two
// sections and the two forms, `mcpSignIn` for the identity flow — and the
// components construct nothing.

import type { ChatStore } from "../domain/chat";
import type { HostPermissions } from "../domain/permissions";
import type { ProviderClientFactory, ProviderRegistry } from "../domain/providers";
import type { SettingsStore } from "../domain/settings";
import type { McpServerRegistry, McpSignIn, McpToolGateway } from "../domain/tools";

export interface OptionsServices {
  providers: ProviderRegistry;
  createProviderClient: ProviderClientFactory;
  mcpServers: McpServerRegistry;
  /** Test/list/call/discover against remote MCP servers — what "Test connection" runs. */
  mcpTools: McpToolGateway;
  /** The discovery -> permissions -> registration -> authorize chain (src/domain/tools/sign-in.ts), which only this surface ever drives. */
  mcpSignIn: McpSignIn;
  settings: SettingsStore;
  /** Only ever read and cleared here (the History section lists what is stored and offers "delete everything"). */
  chats: ChatStore;
  permissions: HostPermissions;
}

let current: OptionsServices | undefined;

/** Called ONCE by src/options/main.ts, before `mount(App)`. Throws on a second call — see the side panel twin for why a duplicate bundle is a real bug, not a harmless one. */
export function initOptionsServices(services: OptionsServices): void {
  if (current) {
    throw new Error("[webmcp] options services were already initialised — main.ts wires them once.");
  }
  current = services;
}

/** The wired services. Throws if the composition root has not run. */
export function optionsServices(): OptionsServices {
  if (!current) {
    throw new Error("[webmcp] options services are not initialised — src/options/main.ts must run first.");
  }
  return current;
}

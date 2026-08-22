// Test-only FAKES for the side panel's app-services bundle (card 84,
// decisions/30-vitest-test-pyramid.md's component tier).
//
// WHY THIS EXISTS. src/sidepanel/app-services.ts is a module singleton:
// `initSidePanelServices` throws on a second call, and every consumer reads
// the bundle back through `sidePanelServices()`/`chat()` at CALL time, not at
// import time. A component test needs the bundle filled with fakes (never the
// real chrome.storage/fetch-backed adapters src/sidepanel/main.ts builds), so
// this module gives every port a minimal, in-memory, override-friendly fake
// and an `initFakeSidePanelServices()` helper that wires them in once.
//
// ONE INIT PER TEST FILE, NOT PER TEST. Vitest already isolates each test
// file in its own module graph by default, so app-services' module-scoped
// `current` starts fresh per FILE with no extra work. Reaching for
// `vi.resetModules()` to get a fresh slot per TEST was tried and reverted: it
// resets EVERY module, including Svelte's own internal runtime, so a
// component imported (even dynamically) after the reset loads a SECOND,
// distinct Svelte internals instance from the one `@testing-library/svelte`'s
// statically-imported `render()` already holds — two reactivity systems
// disagreeing about the same component tree, which surfaced in practice as a
// `Cannot read properties of null (reading 'nodes')` crash from Svelte's own
// effect bookkeeping the moment a bits-ui component (DropdownMenu, Popover)
// tried to mount. Call `initFakeSidePanelServices` ONCE per file (e.g. from a
// `beforeAll`), then drive different scenarios within that file by
// REASSIGNING a method on the returned `services` object (every field
// `createFakeSidePanelServices` returns is a plain, non-readonly property)
// before each `it()` — never by trying to re-init.
//
// WHAT THIS DOES NOT COVER. Composer.svelte, ApprovalCard.svelte,
// Transcript.svelte and ProviderPicker.svelte never import app-services
// directly — they read the side panel's OWN reactive stores
// (src/sidepanel/stores/selection.svelte.ts, stores/approvals.svelte.ts,
// stores/panel.svelte.ts), which in turn read app-services. Driving those
// four components through a real store means recreating the store's own
// async orchestration (syncToTab's provider-list load, per-provider
// capability resolution, etc.) in every test — logic that belongs to the
// STORE's own tests, not to a component test. Their test files instead
// `vi.mock` the specific store module and assert against the component's
// actual behaviour over whatever that mock reports — see each test file's
// header comment for the exact shape. This module is for the components that
// DO read app-services directly: OverflowMenu.svelte, HistoryPanel.svelte,
// and (via src/options/testing/fake-services.ts's twin) the options surface.
//
// USAGE:
//
//   import { initFakeSidePanelServices, createFakeSidePanelServices } from "../testing/fake-services";
//   import OverflowMenu from "../components/OverflowMenu.svelte";
//
//   describe("OverflowMenu", () => {
//     const services = createFakeSidePanelServices();
//     beforeAll(() => initFakeSidePanelServices(services));
//
//     it("...", async () => {
//       services.chats.listChatSummaries = async () => [ /* ... */ ];
//       render(OverflowMenu, { props: { ... } });
//     });
//   });

import { vi } from "vitest";
import { initSidePanelServices } from "../app-services";
import type {
  PageToolAccess,
  SidePanelServices,
  ExtensionShellAccess,
  TracingSwitch,
} from "../app-services";
import type {
  ChatService,
  ChatServiceSnapshot,
  ChatStore,
  ChatSummary,
  RunTurnRequest,
} from "../../domain/chat";
import type {
  ProviderClientFactory,
  ProviderConfig,
  ProviderRegistry,
  ProviderSelection,
} from "../../domain/providers";
import type { ApprovalPolicy, McpApprovalPolicy, SettingsStore } from "../../domain/settings";
import type { McpServerConfig, McpServerRegistry, McpToolGateway } from "../../domain/tools";
import type { HostPermissions } from "../../domain/permissions";

// ---------------------------------------------------------------------------
// Individual port fakes — each a total, in-memory implementation a test can
// override piecemeal via createFakeSidePanelServices's `overrides` argument.
// ---------------------------------------------------------------------------

export function createFakeChatStore(overrides: Partial<ChatStore> = {}): ChatStore {
  return {
    getChat: async () => undefined,
    getOrCreateChatForTab: async () => ({
      chat: {
        id: "fake-chat",
        origin: "https://example.com",
        messages: [],
        toolCalls: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      resolved: false,
    }),
    setCurrentChatForTab: async () => undefined,
    save: async () => undefined,
    flush: async () => undefined,
    flushAll: async () => undefined,
    deleteChat: async () => undefined,
    clearAllChats: async () => undefined,
    listChatSummaries: async () => [],
    ...overrides,
  };
}

/**
 * A ChatService fake with every method a harmless no-op/default — every test
 * that only cares about a handful of methods (e.g. OverflowMenu's
 * `chat().openChat`) can override just those via `overrides`.
 */
export function createFakeChatService(overrides: Partial<ChatService> = {}): ChatService {
  return {
    current: () => undefined,
    activeTabId: () => undefined,
    activeTabOrigin: () => "",
    syncToTab: async () => undefined,
    applyNavigation: async () => undefined,
    startNewChat: async () => undefined,
    openChat: async () => false,
    discardIfDeleted: async () => undefined,
    renameCurrent: async () => undefined,
    getSelection: () => undefined,
    setSelection: async () => false,
    addUserMessage: () => "",
    beginAssistantMessage: () => "",
    appendAssistantDelta: () => undefined,
    endAssistantMessage: () => undefined,
    addToolCall: (call) => call.id,
    updateToolCallResult: () => undefined,
    addAssistantNote: () => "",
    runTurn: async (_userText: string, _request: RunTurnRequest) => undefined,
    requestStop: () => undefined,
    isTurnActive: () => false,
    snapshot: (): ChatServiceSnapshot => ({
      chatId: undefined,
      messageCount: 0,
      toolCallCount: 0,
      liveSessionIds: [],
    }),
    ...overrides,
  };
}

export function createFakeProviderRegistry(
  initial: ProviderConfig[] = [],
  overrides: Partial<ProviderRegistry> = {},
): ProviderRegistry {
  let providers = [...initial];
  let defaultSelection: ProviderSelection | undefined;
  return {
    listProviders: async () => providers,
    getProvider: async (id) => providers.find((p) => p.id === id),
    addProvider: async (input) => {
      const config: ProviderConfig = { ...input, id: `provider-${providers.length + 1}` };
      providers = [...providers, config];
      return config;
    },
    updateProvider: async (id, patch) => {
      const idx = providers.findIndex((p) => p.id === id);
      if (idx === -1) return undefined;
      providers[idx] = { ...providers[idx], ...patch };
      return providers[idx];
    },
    removeProvider: async (id) => {
      providers = providers.filter((p) => p.id !== id);
    },
    reorderProviders: async (orderedIds) => {
      providers = orderedIds
        .map((id) => providers.find((p) => p.id === id))
        .filter((p): p is ProviderConfig => p !== undefined);
    },
    getDefaultSelection: async () => defaultSelection,
    setDefaultSelection: async (selection) => {
      defaultSelection = selection;
    },
    ...overrides,
  };
}

/** A ProviderClientFactory fake — every config resolves to the same stub ChatProvider unless a test supplies its own. */
export function createFakeProviderClientFactory(
  factory: ProviderClientFactory = (config) => ({
    type: config.type,
    listModels: async () => ({ ok: true, value: [] }),
    getCapabilities: async () => ({ ok: true, value: { status: "unknown" } }),
    // eslint-disable-next-line require-yield -- test stub, never actually iterated in these component tests
    chat: async function* () {
      return;
    },
  }),
): ProviderClientFactory {
  return factory;
}

export function createFakeSettingsStore(overrides: Partial<SettingsStore> = {}): SettingsStore {
  let approvalPolicy: ApprovalPolicy = "default";
  let mcpApprovalPolicy: McpApprovalPolicy = "always-confirm";
  return {
    getApprovalPolicy: async () => approvalPolicy,
    setApprovalPolicy: async (policy) => {
      approvalPolicy = policy;
    },
    onApprovalPolicyChange: () => () => undefined,
    getMcpApprovalPolicy: async () => mcpApprovalPolicy,
    setMcpApprovalPolicy: async (policy) => {
      mcpApprovalPolicy = policy;
    },
    onMcpApprovalPolicyChange: () => () => undefined,
    ...overrides,
  };
}

export function createFakeMcpServerRegistry(
  initial: McpServerConfig[] = [],
  overrides: Partial<McpServerRegistry> = {},
): McpServerRegistry {
  let servers = [...initial];
  return {
    listServers: async () => servers,
    listEnabledServers: async () => servers.filter((s) => s.enabled),
    getServer: async (id) => servers.find((s) => s.id === id),
    addServer: async (input) => {
      const config: McpServerConfig = {
        enabled: true,
        transport: "auto",
        ...input,
        id: `server-${servers.length + 1}`,
      };
      servers = [...servers, config];
      return config;
    },
    updateServer: async (id, patch) => {
      const idx = servers.findIndex((s) => s.id === id);
      if (idx === -1) return undefined;
      servers[idx] = { ...servers[idx], ...patch };
      return servers[idx];
    },
    removeServer: async (id) => {
      servers = servers.filter((s) => s.id !== id);
    },
    reorderServers: async (orderedIds) => {
      servers = orderedIds
        .map((id) => servers.find((s) => s.id === id))
        .filter((s): s is McpServerConfig => s !== undefined);
    },
    ...overrides,
  };
}

export function createFakeMcpToolGateway(overrides: Partial<McpToolGateway> = {}): McpToolGateway {
  return {
    testServerConnection: async () => ({
      ok: true,
      value: { protocolVersion: "2025-06-18" },
    }),
    listServerTools: async () => ({ ok: true, value: [] }),
    callServerTool: async () => ({ ok: true, value: { content: [], isError: false } }),
    discoverAllServerTools: async () => [],
    ...overrides,
  };
}

export function createFakeHostPermissions(
  overrides: Partial<HostPermissions> = {},
): HostPermissions {
  return {
    has: async () => true,
    request: async () => true,
    onChanged: () => () => undefined,
    ...overrides,
  };
}

export function createFakePageToolAccess(overrides: Partial<PageToolAccess> = {}): PageToolAccess {
  return {
    toolsForTab: async () => [],
    executorForTab: (_tabId: number) => async () => ({
      ok: false,
      error: "not implemented in test fake",
    }),
    ...overrides,
  };
}

export function createFakeExtensionShell(
  overrides: Partial<ExtensionShellAccess> = {},
): ExtensionShellAccess {
  return {
    openOptionsPage: vi.fn(),
    ...overrides,
  };
}

export function createFakeTracingSwitch(overrides: Partial<TracingSwitch> = {}): TracingSwitch {
  let enabled = false;
  return {
    isEnabled: () => enabled,
    set: async (next) => {
      enabled = next;
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The full bundle
// ---------------------------------------------------------------------------

export function createFakeSidePanelServices(
  overrides: Partial<SidePanelServices> = {},
): SidePanelServices {
  return {
    chat: createFakeChatService(),
    chats: createFakeChatStore(),
    providers: createFakeProviderRegistry(),
    createProviderClient: createFakeProviderClientFactory(),
    settings: createFakeSettingsStore(),
    mcpServers: createFakeMcpServerRegistry(),
    mcpTools: createFakeMcpToolGateway(),
    permissions: createFakeHostPermissions(),
    pageTools: createFakePageToolAccess(),
    shell: createFakeExtensionShell(),
    tracing: createFakeTracingSwitch(),
    ...overrides,
  };
}

/**
 * Initialise the (per-test-FILE) `app-services` singleton with `services`.
 *
 * Vitest already isolates each test file in its own module graph by default
 * — `src/sidepanel/app-services.ts`'s module-scoped `current` starts fresh
 * per file, with no `vi.resetModules()` needed. Reaching for
 * `vi.resetModules()` here was tried and reverted: it resets EVERY module,
 * including `svelte`'s own internal runtime, so a component dynamically
 * imported afterwards loads a second, distinct Svelte internals instance
 * from the one `@testing-library/svelte`'s statically-imported `render()`
 * already holds — two different reactivity systems disagreeing about the
 * same component tree, which surfaces as a `Cannot read properties of null
 * (reading 'nodes')` crash from Svelte's own effect bookkeeping. Confirmed by
 * reproduction while building this helper.
 *
 * Call this ONCE per test file — `initSidePanelServices` throws on a second
 * call within the same file's module instance, same as it does in the real
 * app. Statically import the component under test at the top of the file as
 * usual; call this from a `beforeAll` (or at module scope) before any
 * `render()`. Different scenarios within the same file are then driven by
 * REASSIGNING a method on the returned `services` object (or on one of its
 * port fakes) before each `it()` — every field `createFakeSidePanelServices`
 * returns is a plain, non-readonly property, so `services.chats.listChatSummaries
 * = async () => [...]` before a given test is enough; nothing needs a second
 * `init` call.
 */
export function initFakeSidePanelServices(
  services: SidePanelServices = createFakeSidePanelServices(),
): SidePanelServices {
  initSidePanelServices(services);
  return services;
}

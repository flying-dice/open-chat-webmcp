// Test-only FAKES for the options page's app-services bundle (card 84,
// decisions/30-vitest-test-pyramid.md's component tier) — the twin of
// src/sidepanel/testing/fake-services.ts. Read that file's header for the
// full rationale of "init once per test FILE, via a plain static import and
// a `beforeAll`, never via `vi.resetModules()`" — the same double-Svelte-
// internals crash it documents applies here identically.
//
// Unlike the side panel, every options component that touches a domain port
// (ProviderForm, McpServerForm, SettingsSection, the various sections) reads
// it straight from `optionsServices()`/its individual accessors at call
// time — none of it is re-exported through an intermediate `.svelte.ts`
// store the way the side panel's selection/approvals/panel stores wrap
// app-services. So this module's `initFakeOptionsServices` is the ONE seam
// every options component test needs.
//
// USAGE:
//
//   import { initFakeOptionsServices, createFakeOptionsServices } from "../testing/fake-services";
//   import SettingsSection from "../components/SettingsSection.svelte";
//
//   describe("SettingsSection", () => {
//     const services = createFakeOptionsServices();
//     beforeAll(() => initFakeOptionsServices(services));
//
//     it("...", async () => {
//       services.settings.getApprovalPolicy = async () => "always-confirm";
//       render(SettingsSection);
//     });
//   });

import { initOptionsServices } from "../app-services";
import type { OptionsServices } from "../app-services";
import type { ChatStore } from "../../domain/chat";
import type {
  ProviderClientFactory,
  ProviderConfig,
  ProviderRegistry,
  ProviderSelection,
} from "../../domain/providers";
import type { ApprovalPolicy, McpApprovalPolicy, SettingsStore } from "../../domain/settings";
import type {
  McpServerConfig,
  McpServerRegistry,
  McpSignIn,
  McpSignInCompletion,
  McpSignInResult,
  McpToolGateway,
} from "../../domain/tools";
import type { HostPermissions } from "../../domain/permissions";

// Re-implemented here (rather than imported from the sidepanel testing
// module) so this surface's tests never depend on src/sidepanel/** at all —
// each surface's test helpers stay as independent as the surfaces themselves.

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

/** A no-op McpSignIn — sign-in always succeeds trivially unless a test overrides `begin`/`completeManual`. */
export function createFakeMcpSignIn(overrides: Partial<McpSignIn> = {}): McpSignIn {
  const signedIn: McpSignInCompletion = {
    status: "signed-in",
    auth: {
      type: "oauth",
      accessToken: "fake-access-token",
      clientId: "fake-client-id",
      authorizationServer: {
        issuer: "https://auth.example.com",
        authorizationEndpoint: "https://auth.example.com/authorize",
        tokenEndpoint: "https://auth.example.com/token",
      },
    },
  };
  return {
    redirectUri: () => "https://fake-extension-id.chromiumapp.org/",
    begin: async (): Promise<McpSignInResult> => signedIn,
    completeManual: async (): Promise<McpSignInCompletion> => signedIn,
    ...overrides,
  };
}

export function createFakeOptionsServices(
  overrides: Partial<OptionsServices> = {},
): OptionsServices {
  return {
    providers: createFakeProviderRegistry(),
    createProviderClient: createFakeProviderClientFactory(),
    mcpServers: createFakeMcpServerRegistry(),
    mcpTools: createFakeMcpToolGateway(),
    mcpSignIn: createFakeMcpSignIn(),
    settings: createFakeSettingsStore(),
    chats: createFakeChatStore(),
    permissions: createFakeHostPermissions(),
    ...overrides,
  };
}

/**
 * Initialise the (per-test-FILE) `app-services` singleton with `services`.
 * Call ONCE per test file, before any `render()` — see this module's header
 * and src/sidepanel/testing/fake-services.ts's twin for why NOT
 * `vi.resetModules()`. Drive different scenarios within the file by
 * reassigning a method on the returned `services` object between tests.
 */
export function initFakeOptionsServices(
  services: OptionsServices = createFakeOptionsServices(),
): OptionsServices {
  initOptionsServices(services);
  return services;
}

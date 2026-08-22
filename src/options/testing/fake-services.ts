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
// CARD 92 (decisions/34-errors-as-values.md): every storage port — ChatStore,
// ProviderRegistry, SettingsStore, McpServerRegistry — now returns
// `Promise<Result<T, StorageError>>` instead of resolving/rejecting bare, so
// these fakes read that way too: every "success" branch below is built with
// `ok(...)` (src/domain/result.ts), never a hand-written `[value,
// undefined]` tuple, and the module-level `storageFailure()` helper below
// (see its own comment) is what a test reaches for to make one FAIL.
//
// CARD 93 brought the `ChatProvider` fake onto the same tuple with the same
// rule: `listModels`/`getCapabilities` return `Result<T, ProviderError>`, and
// a test that wants a provider failure builds it with `fail({kind: ...})` —
// the `ProviderError` vocabulary is a plain union, so there is no
// `storageFailure()`-style helper to reach for.
//
// USAGE:
//
//   import { initFakeOptionsServices, createFakeOptionsServices, storageFailure } from "../testing/fake-services";
//   import SettingsSection from "../components/SettingsSection.svelte";
//
//   describe("SettingsSection", () => {
//     const services = createFakeOptionsServices();
//     beforeAll(() => initFakeOptionsServices(services));
//
//     it("...", async () => {
//       services.settings.getApprovalPolicy = async () => ok("always-confirm");
//       render(SettingsSection);
//     });
//
//     it("...", async () => {
//       services.settings.setApprovalPolicy = async () => fail(storageFailure());
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
import { ok } from "../../domain/result";
import { StorageError, type StorageErrorKind } from "../../domain/storage";

// Re-implemented here (rather than imported from the sidepanel testing
// module) so this surface's tests never depend on src/sidepanel/** at all —
// each surface's test helpers stay as independent as the surfaces themselves.

/**
 * Build a `StorageError` for a test that wants one storage-port call to
 * FAIL — the fake's equivalent of the real adapter's own failure. Exists
 * because every storage port below has multiple methods that can fail the
 * same way, and every one of those tests wants the same three things: a
 * real `StorageError` instance (not a bare string or a plain object a
 * caller's `instanceof` check would reject), a plausible default `kind`,
 * and a message worth reading in a failed assertion's diff. Defaulting
 * `kind` to `"Unavailable"` matches the one real construction site
 * (src/infra/chrome-storage/area.ts): it's the ordinary "the store didn't
 * answer" case, and a test that cares about a DIFFERENT kind (e.g.
 * `"Corrupt"`) passes it explicitly.
 *
 *   services.settings.setApprovalPolicy = async () => fail(storageFailure());
 *   services.chats.listChatSummaries = async () => fail(storageFailure("Corrupt", "bad record"));
 */
export function storageFailure(
  kind: StorageErrorKind = "Unavailable",
  message = "fake storage failure",
): StorageError {
  return new StorageError(kind, message);
}

export function createFakeChatStore(overrides: Partial<ChatStore> = {}): ChatStore {
  return {
    getChat: async () => ok(undefined),
    getOrCreateChatForTab: async () =>
      ok({
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
    setCurrentChatForTab: async () => ok(),
    save: async () => ok(),
    flush: async () => ok(),
    flushAll: async () => ok(),
    deleteChat: async () => ok(),
    clearAllChats: async () => ok(),
    listChatSummaries: async () => ok([]),
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
    listProviders: async () => ok(providers),
    getProvider: async (id) => ok(providers.find((p) => p.id === id)),
    addProvider: async (input) => {
      const config: ProviderConfig = { ...input, id: `provider-${providers.length + 1}` };
      providers = [...providers, config];
      return ok(config);
    },
    updateProvider: async (id, patch) => {
      const idx = providers.findIndex((p) => p.id === id);
      const current = providers[idx];
      if (idx === -1 || !current) return ok(undefined);
      const updated: ProviderConfig = { ...current, ...patch };
      providers[idx] = updated;
      return ok(updated);
    },
    removeProvider: async (id) => {
      providers = providers.filter((p) => p.id !== id);
      return ok();
    },
    reorderProviders: async (orderedIds) => {
      providers = orderedIds
        .map((id) => providers.find((p) => p.id === id))
        .filter((p): p is ProviderConfig => p !== undefined);
      return ok();
    },
    getDefaultSelection: async () => ok(defaultSelection),
    setDefaultSelection: async (selection) => {
      defaultSelection = selection;
      return ok();
    },
    ...overrides,
  };
}

export function createFakeProviderClientFactory(
  factory: ProviderClientFactory = (config) => ({
    type: config.type,
    listModels: async () => ok([]),
    getCapabilities: async () => ok({ status: "unknown" }),
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
    getApprovalPolicy: async () => ok(approvalPolicy),
    setApprovalPolicy: async (policy) => {
      approvalPolicy = policy;
      return ok();
    },
    onApprovalPolicyChange: () => () => undefined,
    getMcpApprovalPolicy: async () => ok(mcpApprovalPolicy),
    setMcpApprovalPolicy: async (policy) => {
      mcpApprovalPolicy = policy;
      return ok();
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
    listServers: async () => ok(servers),
    listEnabledServers: async () => ok(servers.filter((s) => s.enabled)),
    getServer: async (id) => ok(servers.find((s) => s.id === id)),
    addServer: async (input) => {
      const config: McpServerConfig = {
        enabled: true,
        transport: "auto",
        ...input,
        id: `server-${servers.length + 1}`,
      };
      servers = [...servers, config];
      return ok(config);
    },
    updateServer: async (id, patch) => {
      const idx = servers.findIndex((s) => s.id === id);
      const current = servers[idx];
      if (idx === -1 || !current) return ok(undefined);
      const updated: McpServerConfig = { ...current, ...patch };
      servers[idx] = updated;
      return ok(updated);
    },
    removeServer: async (id) => {
      servers = servers.filter((s) => s.id !== id);
      return ok();
    },
    reorderServers: async (orderedIds) => {
      servers = orderedIds
        .map((id) => servers.find((s) => s.id === id))
        .filter((s): s is McpServerConfig => s !== undefined);
      return ok();
    },
    ...overrides,
  };
}

export function createFakeMcpToolGateway(overrides: Partial<McpToolGateway> = {}): McpToolGateway {
  return {
    testServerConnection: async () => ok({ protocolVersion: "2025-06-18" }),
    listServerTools: async () => ok([]),
    callServerTool: async () => ok({ content: [], isError: false }),
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

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
// Transcript.svelte and ModelPicker.svelte never import app-services
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
//       services.chats.listChatSummaries = async () => ok([ /* ... */ ]);
//       render(OverflowMenu, { props: { ... } });
//     });
//
//     it("...on a storage failure...", async () => {
//       services.chats.listChatSummaries = async () => fail(storageFailure());
//       render(OverflowMenu, { props: { ... } });
//     });
//   });
//
// CARD 92 (decisions/34-errors-as-values.md): every storage port method below
// returns `Result<T, StorageError>` (../../domain/result), not a bare `T` a
// caller could only get by awaiting successfully. A fake's SUCCESS arm is
// built with `ok(...)` and its FAILURE arm (an override a test supplies) with
// `fail(storageFailure())` — see that helper below for why.
//
// CARD 93 brought the `ChatProvider` fake onto the same tuple: its
// `listModels`/`getCapabilities` now return `Result<T, ProviderError>` and
// their success arms are `ok(...)` too. CARD 94 did the same for
// `McpToolGateway`'s fake below (`Result<T, McpError>`, same `ok(...)`
// construction). The remaining `PageToolAccess`/`ChatService` fakes still
// speak their own vocabularies (a plain `{ok,result}`/`{ok,error}` record,
// or plain values) — see each port's own module for why.

import { initSidePanelServices } from "../app-services";
import type {
  PageToolAccess,
  SidePanelServices,
  ExtensionShellAccess,
  TracingSwitch,
} from "../app-services";
import { ok } from "../../domain/result";
import { StorageError, type StorageErrorKind } from "../../domain/storage";
import type {
  ChatService,
  ChatServiceSnapshot,
  ChatStore,
  PageContextMode,
  PageContextSource,
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

/**
 * Build a `StorageError` for a fake port method's failure-arm override, e.g.
 * `services.chats.listChatSummaries = async () => fail(storageFailure());`.
 *
 * Exists because a test exercising a port's failure path almost never cares
 * WHICH of the five `StorageErrorKind`s it is or what the message says — only
 * that the call failed — so writing `new StorageError("Unavailable", "...")`
 * out at every override site would be repetition with no signal in it.
 * Defaults to `"Unavailable"`, the one kind a real adapter actually produces
 * (see src/domain/storage/error.ts's header), and a message that names itself
 * as a fixture rather than something that could be mistaken for a real fault
 * in a failed assertion's output. Both are overridable for the rare test that
 * asserts on the error itself (e.g. a surface that switches on `.kind`).
 */
export function storageFailure(
  kind: StorageErrorKind = "Unavailable",
  message = "fake storage failure",
): StorageError {
  return new StorageError(kind, message);
}

// ---------------------------------------------------------------------------
// Individual port fakes — each a total, in-memory implementation a test can
// override piecemeal via createFakeSidePanelServices's `overrides` argument.
// ---------------------------------------------------------------------------

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
    // Card 95: the five USER-DRIVEN lifecycle methods return
    // `Result<…, StorageError>` now (src/domain/chat/service.ts) — a fake
    // that answers `ok(false)`/`ok()` is the "nothing happened, and nothing
    // went wrong" default; a test that wants the failure path overrides with
    // `fail(storageFailure(...))`.
    startNewChat: async () => ok(),
    openChat: async () => ok(false),
    discardIfDeleted: async () => ok(),
    renameCurrent: async () => ok(),
    getSelection: () => undefined,
    setSelection: async () => ok(false),
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
    listProviders: async () => ok(providers),
    getProvider: async (id) => ok(providers.find((p) => p.id === id)),
    addProvider: async (input) => {
      const config: ProviderConfig = { ...input, id: `provider-${providers.length + 1}` };
      providers = [...providers, config];
      return ok(config);
    },
    updateProvider: async (id, patch) => {
      const idx = providers.findIndex((p) => p.id === id);
      const existing = providers[idx];
      if (existing === undefined) return ok(undefined);
      const updated: ProviderConfig = { ...existing, ...patch, id: existing.id };
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

/** A ProviderClientFactory fake — every config resolves to the same stub ChatProvider unless a test supplies its own. */
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
      const existing = servers[idx];
      if (existing === undefined) return ok(undefined);
      const updated: McpServerConfig = { ...existing, ...patch, id: existing.id };
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

/**
 * A `PageContextSource` fake (card 118's port, card 119's gate). Answers a
 * SUCCESSFUL EMPTY snapshot by default, which is the honest baseline: an empty
 * selection is the ordinary state of a page nobody has highlighted anything
 * on, and decisions/40 requires that to be a success rather than an error, so
 * a test that has not opted into a selection must not see a chip.
 *
 * A test drives the interesting cases by reassigning `pull` — returning a
 * snapshot with text for the chip lifecycle, or `fail(new PageContextError(…))`
 * for the restricted/unreachable split.
 */
export function createFakePageContextSource(
  overrides: Partial<PageContextSource> = {},
): PageContextSource {
  return {
    pull: async (_tabId: number, mode: PageContextMode) =>
      ok({
        mode,
        text: "",
        url: "https://example.com/",
        title: "Example",
        truncated: false,
        bytes: 0,
      }),
    ...overrides,
  };
}

/**
 * Card 123: `openOptionsPage` used to default to `vi.fn()`, which made this
 * whole module import `vitest` — fine under Vitest, fatal in Storybook, whose
 * preview is a BROWSER bundle that renders stories through these very fakes
 * (decisions/42-storybook.md's "one source of fake truth"). Vitest is not
 * resolvable there, so the import took the whole preview down before a story
 * could render.
 *
 * The default is a plain no-op now, which costs nothing: every test that
 * ASSERTS on this call already installs its own spy first
 * (OverflowMenu.test.ts:97, ModelPicker.test.ts:70, Transcript.test.ts:31) —
 * the default was never the thing being asserted on. Nothing else in this
 * module needed `vitest`, so the import is gone entirely and both surfaces'
 * fake bundles are now importable from any bundler.
 */
export function createFakeExtensionShell(
  overrides: Partial<ExtensionShellAccess> = {},
): ExtensionShellAccess {
  return {
    openOptionsPage: () => undefined,
    ...overrides,
  };
}

export function createFakeTracingSwitch(overrides: Partial<TracingSwitch> = {}): TracingSwitch {
  let enabled = false;
  return {
    isEnabled: () => enabled,
    set: async (next) => {
      enabled = next;
      return ok();
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
    pageContext: createFakePageContextSource(),
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
 * = async () => ok([...])` before a given test is enough; nothing needs a
 * second `init` call.
 */
export function initFakeSidePanelServices(
  services: SidePanelServices = createFakeSidePanelServices(),
): SidePanelServices {
  initSidePanelServices(services);
  return services;
}

// The side panel's COMPOSITION ROOT (decisions/29-ddd-hexagonal-typescript-layout.md,
// .claude/skills/ddd-hexagonal/SKILL.md). Card 78 made that true rather than
// aspirational: this file is now the only module on this surface that names
// `src/infra` at all, and `only-roots-construct-infra` in
// .dependency-cruiser.cjs enforces it.
//
// Its three jobs, in order:
//
//   1. BUILD the adapters — once each. `createChromeStoragePorts()` in
//      particular must be called exactly once per surface: the chat store it
//      returns owns a debounced write map and an index-write queue, and two
//      of them would stop serializing against each other (the interleaving
//      card 55 fixed).
//   2. COMPOSE them into the domain — `createChatService` with this panel's
//      presenter, the approval-policy gate, the injected `originLabel`
//      wording and the outermost rung of the timeout ladder; `createMcpSignIn`
//      with the OAuth client and the permissions adapter — and hand the
//      result to the UI through src/sidepanel/app-services.ts.
//   3. OWN this surface's runtime concerns — theme sync, the `chrome.tabs`
//      listeners that keep the panel pointed at the active tab, and the
//      pagehide flush.
//
// Everything below happens BEFORE `mount(App)` so the first paint already has
// a wired app: components and stores call `sidePanelServices()` at module
// scope in places, and the tab sync's first refresh can land a restored
// transcript before anything renders.

import { mount } from "svelte";
// Tailwind v4 + the shadcn-svelte Zinc/Maia token block — the panel's ONLY
// stylesheet (decisions/28-shadcn-svelte-maia-zinc.md). Card 72 deleted the
// two legacy sheets this entry point used to import alongside it
// (`src/lib/theme.css` and `src/sidepanel/chat-theme.css`); every component
// now styles itself with Tailwind utilities and shadcn variants, so nothing
// reads their custom properties any more, and their unlayered element reset
// (`button`, `input`, `h1-h3`, `body`) was actively outranking Tailwind's
// layered utilities.
import "../app.css";
import App from "./App.svelte";

import { createChatService } from "../domain/chat";
import { createProviderClientFactory } from "../domain/providers";
import { createApprovalPolicyGate } from "../domain/settings";
import {
  createChromeHostPermissions,
  createExtensionShell,
  createPageToolExecutor,
  createTabToolsLookup,
  startTabSync,
} from "../infra/chrome-runtime";
import { createChromeStoragePorts } from "../infra/chrome-storage";
import { startDarkModeSync } from "../infra/dom";
import { createMcpOAuthClient, createMcpToolGateway } from "../infra/mcp";
import { createOllamaProvider } from "../infra/ollama";
import { createOpenAiProvider } from "../infra/openai";
import { AGENT_LOOP_TOOL_CALL_TIMEOUT_MS } from "../infra/webmcp";

import { initSidePanelServices } from "./app-services";
import { originLabel } from "./lib/toolOrigin";
import { presenter, tabSyncView } from "./stores/panel.svelte";

// ---------------------------------------------------------------------------
// 1. Adapters
// ---------------------------------------------------------------------------

const storage = createChromeStoragePorts();
const permissions = createChromeHostPermissions();

// Card 75: the old `registerProviderType`/`createProviderClient` locator
// needed a self-registering side-effect import of the OpenAI client on every
// entry point that could construct one — a latent "unregistered provider
// type" throw for any new entry point that forgot it. This is the exhaustive
// `Record<ProviderType, ...>` that replaced it: adding a third provider type
// is a compile error here rather than a runtime throw.
// TODO: clean-code - 0.25 - DRY: this createProviderClientFactory composition-root wiring block is copy-pasted verbatim from src/options/main.ts.
const createProviderClient = createProviderClientFactory({
  ollama: (config) =>
    createOllamaProvider(config, {
      capabilityCache: storage.modelCapabilityCache,
      defaults: storage.providerDefaults,
    }),
  openai: createOpenAiProvider,
});

// The side panel never signs anyone in (that is the options page's job), so
// it uses the OAuth client only for `getValidAuth`'s token refresh — but it
// is the same object either way, and `McpTokenResolver` is what the gateway
// asks for.
const mcpOAuthClient = createMcpOAuthClient({ tokenStore: storage.mcpAuthTokenStore });
const mcpToolGateway = createMcpToolGateway({ auth: mcpOAuthClient });

/** Sync-path tracing (decisions/25, card 59), gated on the stored flag rather than `import.meta.env.DEV` — see src/infra/chrome-storage/debug-flags.ts for why a runtime toggle is the only thing that works in an installed build. */
const trace = (...args: unknown[]) => {
  if (storage.tracingFlag.isEnabled()) console.log("[webmcp][tab-sync]", ...args);
};

// ---------------------------------------------------------------------------
// 2. Compose, and hand to the UI
// ---------------------------------------------------------------------------

const chat = createChatService({
  store: storage.chatStore,
  presenter,
  policy: createApprovalPolicyGate(storage.settingsStore),
  // Presentation, injected: card 73 moved `originLabel` out of the domain
  // deliberately, and decisions/19 §6 requires the system prompt to name a
  // tool's origin in the SAME words the approval card and call log use.
  originLabel,
  // The outermost rung of the shared timeout ladder
  // (src/infra/webmcp/timeouts.mjs). Injected because the ladder is a property
  // of the messaging infrastructure — the domain must not import an adapter to
  // learn a number.
  toolCallTimeoutMs: AGENT_LOOP_TOOL_CALL_TIMEOUT_MS,
  trace: (event, detail) => trace(event, detail),
  reportWriteFailure: (message, cause) => console.error(message, cause),
});

const toolsForTab = createTabToolsLookup({ trace });

initSidePanelServices({
  chat,
  chats: storage.chatStore,
  providers: storage.providerRegistry,
  createProviderClient,
  settings: storage.settingsStore,
  mcpServers: storage.mcpServerRegistry,
  mcpTools: mcpToolGateway,
  permissions,
  pageTools: { toolsForTab, executorForTab: createPageToolExecutor },
  shell: createExtensionShell(),
  tracing: storage.tracingFlag,
});

// ---------------------------------------------------------------------------
// 3. This surface's runtime concerns
// ---------------------------------------------------------------------------

// Must run before mount so the first paint is already in the right theme.
startDarkModeSync();

// Keeps the panel's page identity — and, on a tab switch or a cross-origin
// navigation, the visible conversation — in step with the active tab
// (decisions/01, decisions/02, decisions/25). Card 78 moved the listeners
// into src/infra/chrome-runtime/tab-sync.ts and this call out of
// App.svelte's `onMount`: it is a lifecycle concern of the surface, and
// starting it here rather than after the first paint means a restored
// transcript can land sooner. Never torn down — the listeners die with this
// document, which is the panel closing.
startTabSync({ session: chat, view: tabSyncView, trace });

// Card 59 item 2: `chrome.storage.local` writes are debounced per chat (the
// chat-store adapter's DEBOUNCE_MS/MAX_WAIT_MS), so the tail of a streamed
// reply can still be sitting unwritten when the panel closes. `flushAll`
// forces every chat with a write in flight to commit synchronously — not just
// the visible one, since decisions/25 §3 / card 58's `liveSessions` means more
// than one chat can be generating at once. `pagehide` (not `beforeunload`,
// which an MV3 extension page is not guaranteed to receive, and not
// `visibilitychange`, which also fires on an ordinary tab switch while the
// panel document stays open and mid-stream work is meant to keep running) is
// Chrome's reliable signal that this document is actually going away.
window.addEventListener("pagehide", () => {
  void storage.chatStore.flushAll();
});

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;

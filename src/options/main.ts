// The options page's COMPOSITION ROOT (decisions/29-ddd-hexagonal-typescript-layout.md,
// .claude/skills/ddd-hexagonal/SKILL.md) — the twin of
// src/sidepanel/main.ts; read that file's header for the three jobs a root
// has and the order they happen in.
//
// Card 78 is what made this real. Before it, seven of this page's eleven
// components called `chrome.*` themselves and three of them constructed
// adapters through interim wiring modules; now every adapter below is built
// here, once, and handed to the UI as ports through
// src/options/app-services.ts. `only-roots-construct-infra` in
// .dependency-cruiser.cjs is what keeps it that way.

import { mount } from "svelte";
// Card 71 (decisions/28-shadcn-svelte-maia-zinc.md): the options page is
// fully migrated to shadcn-svelte + Tailwind, so this is its ONLY stylesheet.
// `src/options/options.css` and `src/lib/theme.css` are both gone — card 72
// deleted the latter outright, along with `src/sidepanel/chat-theme.css`, once
// the side panel stopped needing it. Nothing else belongs here: the shadcn
// token block plus Tailwind's own theme is the single source of styling for
// both entry points.
import "../app.css";
import App from "./App.svelte";

import { createProviderClientFactory } from "../domain/providers";
import { createMcpSignIn } from "../domain/tools";
import { createChromeHostPermissions } from "../infra/chrome-runtime";
import { createChromeStoragePorts } from "../infra/chrome-storage";
import { startDarkModeSync } from "../infra/dom";
import { createMcpOAuthClient, createMcpToolGateway } from "../infra/mcp";
import { createOllamaProvider } from "../infra/ollama";
import { createOpenAiProvider } from "../infra/openai";

import { initOptionsServices } from "./app-services";

const storage = createChromeStoragePorts();
const permissions = createChromeHostPermissions();

// Card 75's exhaustive `Record<ProviderType, ...>` dispatcher — see the side
// panel root for why the old runtime locator went. Both surfaces build their
// own, from their own storage ports, so neither imports the other's.
// TODO: clean-code - 0.25 - DRY: this createProviderClientFactory composition-root wiring block is copy-pasted verbatim from src/sidepanel/main.ts.
const createProviderClient = createProviderClientFactory({
  ollama: (config) =>
    createOllamaProvider(config, {
      capabilityCache: storage.modelCapabilityCache,
      defaults: storage.providerDefaults,
    }),
  openai: createOpenAiProvider,
});

// Unlike the side panel, this surface uses the WHOLE OAuth client:
// McpServerForm.svelte drives discovery, dynamic registration and the
// interactive sign-in from a click handler (card 63), through the
// `McpSignIn` service that owns their ORDER (src/domain/tools/sign-in.ts).
const mcpOAuthClient = createMcpOAuthClient({ tokenStore: storage.mcpAuthTokenStore });

initOptionsServices({
  providers: storage.providerRegistry,
  createProviderClient,
  mcpServers: storage.mcpServerRegistry,
  mcpTools: createMcpToolGateway({ auth: mcpOAuthClient }),
  mcpSignIn: createMcpSignIn({ oauth: mcpOAuthClient, permissions }),
  settings: storage.settingsStore,
  chats: storage.chatStore,
  permissions,
});

// Must run before mount so the first paint is already in the right theme.
startDarkModeSync();

// `#app` is in this surface's own index.html, so its absence is a packaging
// bug, not a runtime condition — decisions/34-errors-as-values.md's "throw
// means the code is wrong" case. Asserting with `!` instead would hand
// `mount()` a null target and fail further from the cause.
const target = document.getElementById("app");
if (target === null) throw new Error("options/index.html is missing its #app mount point.");

const app = mount(App, {
  target,
});

export default app;

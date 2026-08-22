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

// `createProviderClient` (src/lib/providers/clients.ts) dispatches by
// provider type via a registry that each client populates through a
// self-registering side-effect import (`registerProviderType(...)` at
// module scope) — Ollama's is pulled in transitively by clients.ts itself,
// but OpenAI's (src/lib/providers/openai.ts) is not imported by anything
// clients.ts owns, since that file was off-limits to the agent that built
// it. The options page is where every provider type must be selectable and
// constructible, so it takes on triggering that registration explicitly.
// NOTE for whoever builds the side panel (card 23): it constructs
// `ChatProvider` clients too (to actually chat), and needs this same
// side-effect import — importing this module here does not register it for
// a different entry point/bundle.
import "../lib/providers/openai";

// CARD 74 — storage wiring. Every `chrome.storage`-backed port this surface
// uses (`ChatStore`, `ProviderRegistry`, `McpServerRegistry`,
// `SettingsStore`, and the two provider-config stores) is built here, once,
// by the composition root. The bundle is currently ALSO exported as named
// bindings from `src/infra/chrome-storage/wiring.ts`, which is what the
// stores and components import while they still take no dependencies — read
// that file's header for why, and for exactly what cards 77/78 delete to
// turn this into real injection. Calling it here is what makes "the root
// constructs the infrastructure" true today rather than aspirational.
import { initChromeStorage } from "../infra/chrome-storage";

import { startDarkModeSync } from "../lib/dark-mode";

initChromeStorage();

// Must run before mount so the first paint is already in the right theme.
startDarkModeSync();

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;

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

// CARD 75: the old `registerProviderType`/`createProviderClient` locator
// (src/lib/providers/clients.ts, deleted) needed a self-registering
// side-effect import of the OpenAI client on every entry point that could
// construct one — a latent "unregistered provider type" throw for any new
// entry point that forgot it. `src/sidepanel/lib/providerClients.ts`
// replaces that with an exhaustive `Record<ProviderType, ...>` built from
// `src/infra/ollama` and `src/infra/openai` directly; there is nothing left
// for this root to import just for its side effect.

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

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

// `createProviderClient` (src/lib/providers/registry.ts) dispatches by
// provider type via a registry that each client populates through a
// self-registering side-effect import (`registerProviderType(...)` at
// module scope) — Ollama's is pulled in transitively by registry.ts itself,
// but OpenAI's (src/lib/providers/openai.ts) is not imported by anything
// registry.ts owns, since that file was off-limits to the agent that built
// it. The options page is where every provider type must be selectable and
// constructible, so it takes on triggering that registration explicitly.
// NOTE for whoever builds the side panel (card 23): it constructs
// `ChatProvider` clients too (to actually chat), and needs this same
// side-effect import — importing this module here does not register it for
// a different entry point/bundle.
import "../lib/providers/openai";

import { startDarkModeSync } from "../lib/dark-mode";

// Must run before mount so the first paint is already in the right theme.
startDarkModeSync();

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;

import { mount } from "svelte";
// Tailwind v4 + the shadcn-svelte Zinc/Maia token block. FIRST, ahead of the
// legacy sheets, so that where preflight and theme.css's element reset
// disagree the legacy rules still win for the components that have not been
// migrated yet (decisions/28-shadcn-svelte-maia-zinc.md).
import "../app.css";
import "../lib/theme.css";
// Material 3 expressive tokens for the panel only — layered over theme.css,
// never loaded by the options page. See decisions/18.
import "./chat-theme.css";
import App from "./App.svelte";

// `createProviderClient` (src/lib/providers/registry.ts) dispatches by
// provider type through a registry each client populates via a
// self-registering side-effect import. Ollama's is pulled in transitively
// by registry.ts itself, but OpenAI's (src/lib/providers/openai.ts)
// registers only when something imports it — registry.ts can't do that
// itself (off-limits to the agent that built it). The options page
// (src/options/main.ts) already does this for its own bundle; the side
// panel is a separate entry point/bundle, so it needs the same import here
// or `createProviderClient` throws for `type: "openai"` the moment the
// picker (src/sidepanel/stores/selection.svelte.ts) tries to build a
// client for an OpenAI-type provider.
import "../lib/providers/openai";

import { startDarkModeSync } from "../lib/dark-mode";

// Must run before mount so the first paint is already in the right theme.
startDarkModeSync();

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;

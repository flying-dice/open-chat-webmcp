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

import { mount } from "svelte";
import App from "./App.svelte";

// Chrome-native design tokens (decisions/08-native-chrome-design-language.md)
// — without this import the options page never loads the token stylesheet
// and every colour/spacing/radius value in this page's CSS falls back to
// nothing.
import "../lib/theme.css";
import "./options.css";

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

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;

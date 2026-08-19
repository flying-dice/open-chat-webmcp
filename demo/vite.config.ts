import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Standalone dev server for the WebMCP demo fixtures
// (boards/project-backlog/15-webmcp-demo-page.md). Deliberately separate
// from the root ../vite.config.ts: no crx plugin, no manifest — this is a
// static site the *extension* is developed and tested against, not part of
// the extension's own build.
//
// `npm run demo` points Vite at this config so the page is served over
// http://localhost, never opened as file:// — a WebMCP page needs a real
// origin for navigator.modelContext / extension content-script injection to
// behave the way it would on a real site.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    port: 5175,
    strictPort: true,
  },
});

import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

// Manifest shape per boards/project-backlog/01-scaffold-vite-svelte-mv3.md
// and decisions/01-side-panel-as-primary-ui.md /
// decisions/02-mainworld-webmcp-bridge.md.
export default defineManifest({
  manifest_version: 3,
  name: "OpenChat (WebMCP)",
  description: pkg.description,
  version: pkg.version,
  minimum_chrome_version: "116",

  permissions: ["sidePanel", "storage", "tabs", "scripting"],
  host_permissions: ["http://localhost/*", "http://127.0.0.1/*"],
  optional_host_permissions: ["http://*/*", "https://*/*"],

  // Toolbar/store icons, see icons/icon.svg and
  // boards/project-backlog/16-extension-icons.md.
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },

  background: {
    service_worker: "src/background/sw.ts",
    type: "module",
  },

  // No default_popup: the toolbar action opens the side panel directly
  // (decisions/01-side-panel-as-primary-ui.md), wired in src/background/sw.ts
  // via chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).
  action: {
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
  },

  side_panel: {
    default_path: "src/sidepanel/index.html",
  },

  options_page: "src/options/index.html",

  // Both content scripts: document_start, all URLs, top frame only (iframe
  // tool discovery is out of scope for v1, see decisions/02).
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/relay.ts"],
      run_at: "document_start",
      all_frames: false,
      world: "ISOLATED",
    },
    {
      matches: ["<all_urls>"],
      js: ["src/inject/bridge.ts"],
      run_at: "document_start",
      all_frames: false,
      world: "MAIN",
    },
  ],
});

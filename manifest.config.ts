import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

// Manifest shape per boards/project-backlog/01-scaffold-vite-svelte-mv3.md,
// decisions/01-side-panel-as-primary-ui.md, and
// decisions/16-native-webmcp-client.md (deleted the MAIN-world bridge
// content script; only the ISOLATED-world relay remains).
export default defineManifest({
  manifest_version: 3,
  name: "OpenChat (WebMCP)",
  description: pkg.description,
  version: pkg.version,
  // 149, not 116: native WebMCP (document.modelContext) is a hard
  // requirement as of decisions/16-native-webmcp-client.md, and it only
  // exists from Chrome 149 onward — the origin trial runs 149-156. The old
  // value of 116 was justified by chrome.sidePanel and `world: "MAIN"`
  // content scripts; the latter no longer exist (the MAIN-world bridge is
  // deleted), and chrome.sidePanel's own minimum (114) is below 149 anyway,
  // so WebMCP is now the binding constraint.
  minimum_chrome_version: "149",

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

  // ISOLATED-world relay only: document_start, all URLs, top frame only
  // (iframe tool discovery is out of scope for v1). It reads
  // `document.modelContext` directly — no MAIN-world content script is
  // injected any more (decisions/16-native-webmcp-client.md deleted the
  // adopt-or-provide bridge that used to run there).
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/relay.ts"],
      run_at: "document_start",
      all_frames: false,
      world: "ISOLATED",
    },
  ],
});

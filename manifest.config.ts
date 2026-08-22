import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

// Manifest shape per boards/project-backlog/01-scaffold-vite-svelte-mv3.md,
// decisions/01-side-panel-as-primary-ui.md, and
// decisions/16-native-webmcp-client.md (deleted the MAIN-world bridge
// content script; only the ISOLATED-world relay remains).
export default defineManifest({
  manifest_version: 3,

  // ── Two localization mechanisms, and why (card 100, decisions/37) ────────
  //
  // Everything the extension RENDERS goes through Paraglide: typed
  // `m.someKey()` functions compiled from messages/{locale}.json, switchable
  // at runtime, with a completeness guard behind it (`npm run guard:i18n`).
  //
  // Everything in THIS FILE cannot. Chrome reads manifest.json before any of
  // our code exists, so the only mechanism it accepts here is its own:
  // `_locales/<locale>/messages.json` plus `__MSG_key__` placeholders, keyed
  // off `default_locale`. No typing, no runtime switching — Chrome picks the
  // locale from the BROWSER's UI language and that is that. Decision 37
  // accepts the duplication as the cost of Chrome's constraint and keeps the
  // two locale sets aligned deliberately (note Chrome spells regional tags
  // with an underscore — `pt_BR`, `zh_CN` — where Paraglide uses the BCP-47
  // hyphen; card 105 owns that translation when the other nine land).
  //
  // The catalogue lives at public/_locales/en/messages.json, so Vite's own
  // `publicDir` copy puts it at the packaged root where Chrome looks for it.
  // `name`/`description` are the two strings that show in the toolbar
  // tooltip, chrome://extensions and a Web Store listing.
  //
  // `description` used to be `pkg.description` — the string now lives in the
  // `_locales` catalogue instead, because a `__MSG_` placeholder is the only
  // form Chrome will localize, and package.json is not a translatable file.
  default_locale: "en",
  name: "__MSG_extName__",
  description: "__MSG_extDescription__",
  version: pkg.version,
  // 149, not 116: native WebMCP (document.modelContext) is a hard
  // requirement as of decisions/16-native-webmcp-client.md, and it only
  // exists from Chrome 149 onward — the origin trial runs 149-156. The old
  // value of 116 was justified by chrome.sidePanel and `world: "MAIN"`
  // content scripts; the latter no longer exist (the MAIN-world bridge is
  // deleted), and chrome.sidePanel's own minimum (114) is below 149 anyway,
  // so WebMCP is now the binding constraint.
  minimum_chrome_version: "149",

  // Every entry below is reached for by name somewhere in src/ — checked at
  // the 0.2.0 release gate (card 86), and worth re-checking whenever one is
  // added, since an unjustified permission is both a store-review problem and
  // a real grant a user has no way to decline.
  //
  //   sidePanel  chrome.sidePanel.setPanelBehavior (src/background/sw.ts)
  //   storage    every repository in src/infra/chrome-storage
  //   tabs       the per-tab registry and tab-sync listeners
  //              (src/background/sw.ts, src/infra/chrome-runtime/tab-sync.ts)
  //   identity   chrome.identity.launchWebAuthFlow/getRedirectURL only
  //              (decisions/27-oauth-for-http-mcp-servers.md) — the generic
  //              web-auth-flow API, not Chrome's Google-specific
  //              getAuthToken flow, so no `oauth2` manifest key is needed
  //              alongside it
  //
  // "scripting" WAS here, from the card 01 scaffold, and is gone as of card
  // 86: it existed for the MAIN-world "adopt-or-provide" bridge, which
  // decisions/16-native-webmcp-client.md deleted outright. Nothing has called
  // chrome.scripting since — the ISOLATED-world relay is a declared
  // `content_scripts` entry, which needs no scripting permission at all — so
  // it had been shipping as a dead grant. `chrome.permissions` itself needs
  // no permission; the optional HOSTS it requests are declared below.
  permissions: ["sidePanel", "storage", "tabs", "identity"],
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

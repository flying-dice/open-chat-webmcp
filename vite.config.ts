import path from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { crx } from "@crxjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import manifest from "./manifest.config.ts";
import { paraglideOptions } from "./paraglide.options.mjs";
import pkg from "./package.json" with { type: "json" };

// https://vite.dev/config/
export default defineConfig({
  // Build-time constants (typed in src/build-globals.d.ts). Card 76: the MCP
  // client announces a name/version in its `initialize` handshake and used to
  // `import pkg from "../../../package.json"` to get them — an adapter
  // reaching outside src/ for build metadata, and the whole manifest in the
  // bundle for two strings. Substituting literals here keeps the wire value
  // identical (same package.json manifest.config.ts reads, just above) while
  // leaving src/infra/mcp with no runtime dependency on it.
  define: {
    __APP_NAME__: JSON.stringify(pkg.name),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // `$lib` is a SvelteKit convention with no runtime behind it — this is a
  // plain multi-entry Vite build, so the alias has to be declared by hand
  // here AND in tsconfig.json/tsconfig.app.json (the shadcn-svelte CLI reads
  // the root tsconfig.json to validate its aliases; svelte-check reads the
  // app one). See decisions/28-shadcn-svelte-maia-zinc.md.
  //
  // Card 78 (decisions/33-shared-ui-layer.md) pointed it at `src/ui`: the
  // folder was `src/lib`, the pre-DDD grab bag decisions/29 set out to empty,
  // and the last thing left in it was the shared UI layer. The ALIAS keeps
  // its `$lib` spelling because that is the name the shadcn-svelte CLI and
  // every file of the vendored kit write; the FOLDER now names its layer.
  resolve: {
    alias: {
      $lib: path.resolve(import.meta.dirname, "./src/ui"),
    },
  },
  plugins: [
    // i18n codegen (decisions/37-i18n-paraglide.md, card 100). FIRST in the
    // list because it WRITES SOURCE: it compiles messages/{locale}.json into
    // src/paraglide/ on `buildStart` and re-runs whenever a message file
    // changes in `npm run dev`, so the typed `m.someKey()` functions every
    // component imports exist before svelte() transforms anything.
    //
    // The options live in paraglide.options.mjs — one object, shared with
    // scripts/compile-i18n.mjs (`postinstall`); see that file for why the
    // strategy chain is what it is and why the output is TS-declared.
    //
    // The generated tree is not ours to hold to our rules and is excluded
    // from every guard: biome.jsonc's `linter.includes`, the `VENDORED` list
    // in scripts/lib/source-scan.mjs (clean-code, return-types, throws,
    // boundaries) and tsconfig.app.json's `exclude`. Who may IMPORT it is
    // still policed — see `paraglide-is-not-for-the-domain` in
    // .dependency-cruiser.cjs.
    paraglideVitePlugin(paraglideOptions),
    // Tailwind v4 has no config file: `@import "tailwindcss"` in src/app.css
    // plus this plugin is the whole setup. It must run before svelte() so the
    // generated stylesheet exists by the time components are transformed.
    tailwindcss(),
    svelte(),
    crx({
      manifest,
      // Card 110. CRXJS's dev-mode live reload calls `chrome.runtime.reload()`
      // whenever the service worker, a content script or the manifest changes.
      // That is right for an extension loaded by hand through
      // chrome://extensions, and WRONG for one Chrome loaded from
      // `--load-extension` (which is how `npm run dev:chrome` and the verify
      // harness both load it): measured on Chrome for Testing 152, the
      // extension does not come back from that reload — every extension URL
      // fails with ERR_BLOCKED_BY_CLIENT afterwards. scripts/dev-chrome.mjs
      // therefore sets CRX_LIVE_RELOAD=false and relaunches the browser itself
      // on exactly those edits. Nothing else sets the variable, so a plain
      // `npm run dev` keeps CRXJS's own behaviour, and `vite build` never runs
      // this code path at all.
      liveReload: process.env.CRX_LIVE_RELOAD !== "false",
      // No `contentScripts.standaloneFiles` carve-out any more: that existed
      // only for the MAIN-world bridge (src/inject/bridge.ts), which needed
      // to be a standalone IIFE with no CRXJS loader/HMR shim in front of it.
      // decisions/16-native-webmcp-client.md deleted that file — the
      // ISOLATED-world relay (src/content/relay.ts) is the only content
      // script left, and it has no such constraint.
    }),
  ],
  build: {
    // MV3 service workers and content scripts don't tolerate arbitrary
    // async chunk splitting well; keep things simple for the scaffold.
    rollupOptions: {
      output: {
        chunkFileNames: "assets/chunk-[hash].js",
      },
    },
  },
});

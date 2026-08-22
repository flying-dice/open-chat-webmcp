import path from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { crx } from "@crxjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import manifest from "./manifest.config.ts";
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
    // Tailwind v4 has no config file: `@import "tailwindcss"` in src/app.css
    // plus this plugin is the whole setup. It must run before svelte() so the
    // generated stylesheet exists by the time components are transformed.
    tailwindcss(),
    svelte(),
    crx({
      manifest,
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

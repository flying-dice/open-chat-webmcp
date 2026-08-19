import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.ts";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
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

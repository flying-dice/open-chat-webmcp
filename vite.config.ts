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
      contentScripts: {
        // The MAIN-world bridge must be a standalone IIFE with no CRXJS
        // loader/HMR shim in front of it — a loader script would be what
        // actually executes in MAIN world instead of our code. See
        // decisions/03-vite-svelte-build.md for why this matters.
        standaloneFiles: ["src/inject/bridge.ts"],
      },
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

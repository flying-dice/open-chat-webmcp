// Vitest toolchain (card 82, decisions/30-vitest-test-pyramid.md).
//
// Deliberately its OWN config file rather than a reuse of vite.config.ts: the
// app build is a multi-entry MV3 bundle (`svelte()` + `crx({manifest})`), and
// the CRXJS manifest plugin must never run under test — it writes a
// `manifest.json`/copies extension assets as a side effect of being loaded,
// none of which means anything to a Vitest run and would only slow every
// `npm test` down chasing a build artifact no test reads. This file reuses
// ONLY the Svelte plugin (so a future `.svelte` component test compiles) and
// the `$lib` alias (mirrored from vite.config.ts/tsconfig.app.json — see the
// comment there for why the alias has to be declared by hand three times).
//
// Two projects (Vitest 4's replacement for the deprecated vitest.workspace.ts
// file — a single `test.projects` array, each entry `extends: true` to
// inherit the plugin/alias above):
//   - "domain": `environment: "node"` for src/domain/**/*.test.ts and
//     src/infra/**/*.test.ts — the domain suite must run with ZERO platform
//     mocks (decisions/29/30), and jsdom would make it too easy to reach for
//     one by accident.
//   - "component": `environment: "jsdom"` for the two Svelte surfaces plus
//     the shared UI layer. Nothing uses it yet — card 84 is the component
//     test card — so vitest.setup.ts's smoke test is the only occupant for
//     now, proving the Svelte-plugin-under-jsdom-under-Testing-Library stack
//     actually works before 84 builds on it.
import path from "node:path";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve(root, "./src/ui"),
    },
  },
  // Mirrors vite.config.ts's `define` (typed in src/build-globals.d.ts):
  // src/infra/mcp/protocol.ts reads these at module scope, so without them
  // any test importing that chain dies with a ReferenceError before running.
  define: {
    __APP_NAME__: JSON.stringify("webmcp-test"),
    __APP_VERSION__: JSON.stringify("0.0.0-test"),
  },
  plugins: [svelte()],
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // decisions/30: the coverage report speaks to the unit layer this card
      // adds (src/domain, src/infra) — cards 83/84 grow src/infra and the two
      // Svelte surfaces' own coverage without this file needing to change.
      include: ["src/domain/**/*.ts", "src/infra/**/*.ts"],
      exclude: [
        "src/domain/**/*.test.ts",
        "src/infra/**/*.test.ts",
        "src/domain/**/index.ts",
        "src/infra/**/index.ts",
        "src/**/*.d.ts",
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "domain",
          environment: "node",
          include: [
            "src/domain/**/*.test.ts",
            "src/infra/**/*.test.ts",
            // The background worker's tests use the same fake-chrome seam as
            // tab-sync.test.ts and run on node like the rest of this project.
            "src/background/**/*.test.ts",
          ],
        },
      },
      {
        extends: true,
        // Vite/vite-plugin-svelte pick the SSR (`mount` unavailable) compile
        // target unless the `browser` resolve condition is present — jsdom
        // being the `test.environment` only supplies globals, it does not by
        // itself change which Svelte output the plugin emits. Scoped to this
        // project only: the "domain" project never touches Svelte, and
        // forcing `browser` resolution there could quietly change which
        // build of some other npm package it resolves.
        resolve: {
          conditions: ["browser"],
        },
        test: {
          name: "component",
          environment: "jsdom",
          setupFiles: [path.resolve(root, "./vitest.setup.ts")],
          include: [
            "src/sidepanel/**/*.test.ts",
            "src/options/**/*.test.ts",
            "src/ui/**/*.test.ts",
          ],
        },
      },
    ],
  },
});

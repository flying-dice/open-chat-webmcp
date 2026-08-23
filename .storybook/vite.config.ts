// The STORY surface's Vite config (card 123, decisions/42-storybook.md).
//
// -- Why this file exists at all ---------------------------------------------
//
// `@storybook/builder-vite` loads the project's root `vite.config.ts` and
// merges it into the config it builds the preview with. Ours ends in
// `crx({ manifest })`, and CRXJS is not a plugin that stays out of the way
// when it isn't wanted: pointed at Storybook's build it took the whole thing
// down on the FIRST attempt of this card with
//
//     [plugin crx:manifest-post] SyntaxError: Unexpected token '.',
//     "./rolldown"... is not valid JSON
//
// — its `generateBundle` hook trying to `JSON.parse` a chunk of Storybook's
// own bundle as if it were the extension manifest. That failure is the
// concrete form of the rule vitest.config.ts states in prose: the CRXJS
// manifest plugin must never load anywhere but the app build. It writes a
// `manifest.json`, copies extension assets, and (in dev) installs a
// live-reload client that calls `chrome.runtime.reload()` — none of which
// means anything to a Storybook iframe that is not an extension page.
//
// So `.storybook/main.ts` points `builder.viteConfigPath` HERE, and this is
// the whole of what the story surface gets. A `viteFinal` hook could not have
// done the job: it runs after the root config has already been merged in, and
// there is no supported way to un-merge a plugin.
//
// -- What it contains, and what it deliberately does not ---------------------
//
//   $lib alias    the shadcn-svelte kit's import spelling. Declared by hand
//                 for the FOURTH time in this repo (vite.config.ts,
//                 tsconfig.json, tsconfig.app.json, here) — see
//                 vite.config.ts's comment for why one copy is not possible.
//   paraglide     the i18n codegen, FIRST because it writes source: the
//                 `m.someKey()` functions every component imports have to
//                 exist before anything is transformed. The SAME shared
//                 options object (paraglide.options.mjs) the app build and
//                 `npm run compile:i18n` use, so a story can never render
//                 against a different message set than the extension ships.
//   tailwindcss   Tailwind v4 has no config file; this plugin plus
//                 `@import "tailwindcss"` in src/app.css (imported by
//                 ./preview.ts) is the entire setup.
//   svelte        yes, ours. `@storybook/svelte-vite` does NOT add one — its
//                 `viteFinal` appends only a docgen plugin and expects the
//                 project's own Vite config to compile `.svelte` (verified by
//                 reading its preset, and before that by watching the build
//                 fail on `@storybook/svelte/static/PreviewRender.svelte` with
//                 "Unexpected JSX expression … JSX syntax is disabled", i.e.
//                 rolldown reading a Svelte file as JS). Exactly one `svelte()`
//                 though: a second would compile every component twice and hand
//                 the story a different Svelte internals instance than the
//                 renderer holds — the two-runtimes failure
//                 src/sidepanel/testing/fake-services.ts documents from the
//                 Vitest side.
//   define        vite.config.ts's build-time constants, for the reason
//                 vitest.config.ts mirrors them too: src/infra/mcp/protocol.ts
//                 reads them at module scope, so any story whose import graph
//                 reaches that chain would die with a ReferenceError before
//                 rendering.
//
// NO `crx()`. That is the point of the file.

import path from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { paraglideOptions } from "../paraglide.options.mjs";

export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve(import.meta.dirname, "../src/ui"),
    },
  },
  define: {
    __APP_NAME__: JSON.stringify("webmcp-storybook"),
    __APP_VERSION__: JSON.stringify("0.0.0-storybook"),
  },
  plugins: [paraglideVitePlugin(paraglideOptions), tailwindcss(), svelte()],
});

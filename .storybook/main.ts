// Storybook's builder config (card 123, decisions/42-storybook.md).
//
// Storybook 10.5 on `@storybook/svelte-vite`, with the official Svelte CSF
// addon (`@storybook/addon-svelte-csf` 5.x — the `defineMeta` + snippet
// rewrite for Svelte 5; the `<Meta>`/`<Template>` components it replaced are
// the pre-5 syntax and appear nowhere in this repo).
//
// The one thing worth stopping on here is `builder.viteConfigPath`. Storybook
// would otherwise load the ROOT vite.config.ts, whose last plugin is
// `crx({ manifest })` — and CRXJS breaks a Storybook build outright, not
// subtly. See ./vite.config.ts's header for the exact failure and for what
// the story surface's Vite config does contain instead.

import type { StorybookConfig } from "@storybook/svelte-vite";

const config: StorybookConfig = {
  // COLOCATED stories (decisions/42): `Component.stories.svelte` sits beside
  // `Component.svelte`, never in a parallel `stories/` tree — the same posture
  // `Component.test.ts` already has, and what makes `npm run guard:stories` a
  // plain per-directory diff rather than a name-matching heuristic.
  stories: ["../src/**/*.stories.svelte"],
  addons: ["@storybook/addon-svelte-csf"],
  framework: {
    name: "@storybook/svelte-vite",
    options: {
      // Relative to `process.cwd()`, per @storybook/builder-vite's own type —
      // i.e. the repo root, which is where every npm script runs from.
      builder: { viteConfigPath: ".storybook/vite.config.ts" },
    },
  },
};

export default config;

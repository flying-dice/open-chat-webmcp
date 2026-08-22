/**
 * The ONE definition of how the inlang project is compiled
 * (decisions/37-i18n-paraglide.md, card 100).
 *
 * Paraglide's compiler options are needed in two places that run at different
 * times and cannot see each other's config:
 *
 *   - `vite.config.ts` — `paraglideVitePlugin()`, which recompiles on every
 *     build and on every `messages/*.json` edit in `npm run dev`. This is
 *     what the SHIPPED bundles are built from.
 *   - `scripts/compile-i18n.mjs` — run from `postinstall`, so a fresh clone
 *     has `src/paraglide/` on disk before anyone runs `npm run check`. The
 *     output directory is generated (it emits its own `.gitignore`), so
 *     without this step `npm ci && npm run check` on a clean checkout would
 *     fail on ~200 unresolved `../paraglide/messages.js` imports.
 *
 * Both import THIS object rather than restating the options, because the
 * `strategy` chain in particular is a behavioural choice (see below) and two
 * copies of it would drift silently: a build always recompiles, so a
 * postinstall that disagreed would only be wrong in the window between
 * `npm ci` and the first build — the hardest kind of difference to notice.
 *
 * It is `.mjs` rather than `.ts` on purpose: `postinstall` runs on a bare
 * `npm ci` where no TypeScript loader is guaranteed, and `vite.config.ts`
 * type-checks against it through `allowJs` + the JSDoc annotation below
 * (tsconfig.node.json).
 *
 * @type {import("@inlang/paraglide-js").CompilerOptions}
 */
export const paraglideOptions = {
  project: "./project.inlang",
  outdir: "./src/paraglide",

  // TS 5.6+ required (repo is on 6.0.2). Without this the compiler emits
  // plain `.js` with JSDoc, and `tsconfig.app.json`'s `include` would drag
  // every generated file into the type program as a ROOT file to be checked
  // under maximal strictness. With it, each message ships a `.d.ts` that TS
  // resolves in preference to the `.js`, so the generated code is TYPED at
  // the call site without being TYPE-CHECKED itself — which is the correct
  // treatment for codegen (same posture as the vendored shadcn kit).
  emitTsDeclarations: true,

  // decisions/37's locale-selection chain, in precedence order:
  //
  //   localStorage       what the options page's language picker writes
  //                      (key `PARAGLIDE_LOCALE`). VERIFIED (card 100) to be
  //                      shared between the side panel and the options page:
  //                      both are documents on the same
  //                      `chrome-extension://<id>` origin, so they see one
  //                      localStorage — no custom `chrome.storage` strategy
  //                      is needed.
  //   preferredLanguage  `navigator.languages`, for a user who has never
  //                      touched the picker.
  //   baseLocale         `en`.
  //
  // Deliberately NOT `cookie` (an extension page sets no cookies) and not
  // `url` (there is no routing here — two static `chrome-extension://` pages).
  strategy: ["localStorage", "preferredLanguage", "baseLocale"],
};

#!/usr/bin/env node
// `npm run compile:i18n`, and `postinstall` (card 100,
// decisions/37-i18n-paraglide.md).
//
// `src/paraglide/` is GENERATED — Paraglide emits a `.gitignore` into it that
// ignores the whole directory, so a fresh clone has none of it. Every
// component that calls `m.someKey()` imports from there, which means
// `npm ci && npm run check` on a clean checkout would fail on unresolved
// imports before a build ever ran. This step is what stops that: install
// compiles the messages, so the tree type-checks from the moment it exists.
//
// A BUILD does not need this — `paraglideVitePlugin()` recompiles on
// `buildStart` and re-runs on every `messages/*.json` edit in `npm run dev`.
// Both read the same options object (paraglide.options.mjs) so the two
// compilations cannot disagree.

import process from "node:process";
import { compile } from "@inlang/paraglide-js";
import { paraglideOptions } from "../paraglide.options.mjs";

await compile(paraglideOptions);
console.log(`compile:i18n — messages compiled to ${paraglideOptions.outdir}`);
process.exit(0);

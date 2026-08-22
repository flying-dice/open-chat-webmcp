#!/usr/bin/env node
// Message-completeness guard — `npm run guard:i18n`
// (decisions/37-i18n-paraglide.md, card 100).
//
// Decision 37 asks for keys that are type-safe in BOTH directions:
//
//   1. a USAGE may not name a key that doesn't exist  — the Paraglide
//      compiler's job. `m.noSuchKey()` is a TypeScript error, because every
//      message compiles to a named export with a `.d.ts` (card 100 proved it
//      by planting one and watching `npm run check` fail).
//   2. a LOCALE may not ship missing a key             — NOBODY'S job, until
//      this file. Paraglide resolves a missing translation at COMPILE time by
//      falling back to the base locale, silently: `de.json` without
//      `optionsPageTitle` produces a `de` bundle that renders the English
//      string, with no warning at build time and no error at runtime. inlang's
//      own lint rule for this (`messageLintRule.inlang.missingTranslation`)
//      and its "Ninja" CI action are deprecated/removed in the 2.x line, so
//      there is nothing upstream to lean on.
//
// So this is direction 2: a set diff of every `messages/<locale>.json` against
// the base locale's key set. MISSING keys (a locale that would silently render
// English) and ORPHAN keys (a locale carrying a key the base no longer has —
// dead translation, and the sign of a rename that only landed in one file)
// both FAIL, each printed with its file and key.
//
// It reads project.inlang/settings.json for `baseLocale`/`locales` rather than
// globbing the directory, so a locale that is DECLARED but whose file is
// missing entirely is a failure too, not an absence nobody notices — that is
// the exact shape card 105 will be adding locales in.
//
// Structure, not just keys: an inlang message file is either a flat
// `key: string` or a `key: [{ declarations, selectors, match }]` variant
// block, and a locale that translates a plural as a bare string loses the
// plural. `keysOf()` therefore records each key's KIND, and a kind that
// disagrees with the base locale's fails alongside the set diff.

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const SETTINGS = path.join(ROOT, "project.inlang", "settings.json");

/** Repo-relative, forward-slashed — the form every guard prints. */
function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

/**
 * The inlang project's declared locales and the pathPattern its message files
 * live at. Read from settings.json so this guard and the compiler can never
 * disagree about which locales the project HAS.
 */
function readProject() {
  const settings = JSON.parse(readFileSync(SETTINGS, "utf8"));
  const messageFormat = settings["plugin.inlang.messageFormat"] ?? {};
  return {
    baseLocale: settings.baseLocale,
    locales: settings.locales ?? [],
    pathPattern: messageFormat.pathPattern ?? "./messages/{locale}.json",
  };
}

/** The absolute path of one locale's message file. */
function messageFile({ pathPattern }, locale) {
  return path.resolve(ROOT, pathPattern.replace("{locale}", locale));
}

/**
 * One locale's keys, as `Map<key, kind>` where kind is `"message"` (a plain
 * string) or `"variants"` (the `[{ match: … }]` block a plural or a gendered
 * message uses). `$schema` is metadata, not a message, and is skipped — the
 * message-format plugin skips it the same way when importing.
 *
 * Returns `null` when the file does not exist, which the caller reports as a
 * declared locale with no file rather than as an empty one.
 */
function keysOf(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const json = JSON.parse(raw);
  const keys = new Map();
  for (const [key, value] of Object.entries(json)) {
    if (key === "$schema") continue;
    keys.set(key, Array.isArray(value) ? "variants" : "message");
  }
  return keys;
}

const project = readProject();
const baseFile = messageFile(project, project.baseLocale);
const baseKeys = keysOf(baseFile);

const failures = [];

if (baseKeys === null) {
  failures.push(`${rel(baseFile)} — the base locale has no message file at all`);
} else if (baseKeys.size === 0) {
  failures.push(`${rel(baseFile)} — the base locale declares no messages`);
}

// The single-locale case (only `en`, as card 100 leaves it) is not a special
// case to skip: the loop below still runs for the base locale itself, where
// the diff is trivially empty but the file-exists and structure checks are
// real. Cards 101-105 add locales; nothing here changes when they do.
const compared = [];
for (const locale of project.locales) {
  const file = messageFile(project, locale);
  const keys = keysOf(file);

  if (keys === null) {
    failures.push(
      `${rel(file)} — locale "${locale}" is declared in project.inlang/settings.json but has no message file`,
    );
    continue;
  }
  compared.push({ locale, file, count: keys.size });
  if (baseKeys === null || locale === project.baseLocale) continue;

  for (const [key, kind] of baseKeys) {
    const own = keys.get(key);
    if (own === undefined) {
      failures.push(`${rel(file)} — MISSING key "${key}" (present in ${project.baseLocale})`);
    } else if (own !== kind) {
      failures.push(
        `${rel(file)} — key "${key}" is a ${own} block but ${project.baseLocale} declares it as ${kind}`,
      );
    }
  }
  for (const key of keys.keys()) {
    if (!baseKeys.has(key)) {
      failures.push(`${rel(file)} — ORPHAN key "${key}" (absent from ${project.baseLocale})`);
    }
  }
}

const summary = compared.map((c) => `${c.locale}:${c.count}`).join(" ");
console.log(
  `guard:i18n — message completeness: base locale "${project.baseLocale}",` +
    ` ${project.locales.length} declared locale(s) [${summary}]`,
);

if (failures.length === 0) {
  console.log("  ok — every locale carries exactly the base locale's key set");
  process.exit(0);
}

console.error(
  `\n  ${failures.length} message-completeness violation(s).` +
    "\n  Paraglide falls back to the base locale for a missing key SILENTLY, at" +
    "\n  compile time (decisions/37) — a shipped locale would render English with" +
    "\n  no warning. Add the key, or remove the orphan:\n",
);
for (const f of failures) console.error(`  ${f}`);
console.error("");
process.exit(1);

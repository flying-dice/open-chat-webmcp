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
//
// Card 105 widened "structure" to the four other ways a TRANSLATION can be
// well-formed JSON with the right keys and still be broken, each of them
// silent at build time exactly like a missing key:
//
//   PLACEHOLDERS  `{count}` is a name, not a position. A translator who
//                 renders it `{anzahl}` produces a message that interpolates
//                 nothing and prints the literal braces; one who drops it
//                 loses the number. The placeholder SET must match the base
//                 locale's, per message and per variant branch.
//   LITERAL BRACES a bare `{` in message TEXT is parsed as a placeholder
//                 whose NAME is whatever sits between the braces (card 101
//                 lost a "{ }" glyph to this). Any brace left after the
//                 declared placeholders are removed is that bug.
//   MARKUP        ten keys carry inline `<code>`/`<strong>`/`<em>`/`<a href>`
//                 rendered through `{@html}` (cards 101-102). A dropped or
//                 mangled tag is a broken layout or a dead attribution link,
//                 so the tag multiset must survive translation byte-for-byte.
//   PLURAL RULES  the compiler emits ONE BRANCH PER `match` CATEGORY and, if
//                 a number selects a category the locale did not write,
//                 returns THE KEY NAME as the string. English has two
//                 categories; ru has four and ar six, and zh/ja/ko have one.
//                 So a locale's categories are checked against
//                 `Intl.PluralRules(locale)` — the same CLDR data Paraglide's
//                 own `registry.plural(locale, …)` selects with at runtime —
//                 rather than against the base locale's, which is the whole
//                 point of localizing a plural. `declarations`/`selectors`
//                 conversely must be IDENTICAL to the base locale's: they name
//                 the inputs the call sites pass.

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

/** The `{placeholder}` names a message text interpolates, sorted, deduped. */
function placeholdersIn(text) {
  const names = new Set();
  for (const match of text.matchAll(/\{([^{}]*)\}/g)) names.add(match[1]);
  return [...names].sort();
}

/**
 * Braces left over once every well-formed `{placeholder}` is removed — the
 * card-101 bug, where a literal `{` in message TEXT becomes a placeholder
 * named after whatever follows it.
 */
function strayBracesIn(text) {
  return text.replace(/\{[A-Za-z_$][A-Za-z0-9_$]*\}/g, "").match(/[{}]/g) ?? [];
}

/** Every HTML tag in a message, sorted — a multiset, so a reorder is allowed. */
function tagsIn(text) {
  return (text.match(/<[^>]+>/g) ?? []).sort();
}

/** The structural fingerprint of one message text: what translation must keep. */
function shapeOf(text) {
  return { placeholders: placeholdersIn(text), tags: tagsIn(text), stray: strayBracesIn(text) };
}

/**
 * One locale's keys, as `Map<key, entry>`. Every entry has a `kind` —
 * `"message"` (a plain string) or `"variants"` (the `[{ match: … }]` block a
 * plural or a gendered message uses) — plus the structural facts a
 * TRANSLATION of it has to preserve (see the header): a `"message"` carries
 * its own `shape`, a `"variants"` block carries its `declarations`,
 * `selectors` and a `shape` per `match` branch.
 *
 * `$schema` is metadata, not a message, and is skipped — the message-format
 * plugin skips it the same way when importing.
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
    if (!Array.isArray(value)) {
      keys.set(key, { kind: "message", shape: shapeOf(String(value)) });
      continue;
    }
    const block = value[0] ?? {};
    const branches = new Map();
    for (const [branch, text] of Object.entries(block.match ?? {})) {
      branches.set(branch, shapeOf(String(text)));
    }
    keys.set(key, {
      kind: "variants",
      declarations: JSON.stringify(block.declarations ?? []),
      selectors: JSON.stringify(block.selectors ?? []),
      selector: (block.selectors ?? [])[0] ?? "",
      branches,
    });
  }
  return keys;
}

/**
 * The CLDR plural categories a locale actually uses, from the same data
 * Paraglide's compiled `registry.plural(locale, …)` selects with at runtime.
 * A tag Node cannot parse falls back to the base locale's two rather than
 * taking the guard down — settings.json is the only source of these tags, so
 * that is a typo in a file this guard is about to fail on anyway.
 */
function pluralCategoriesOf(locale) {
  try {
    return new Intl.PluralRules(locale).resolvedOptions().pluralCategories.slice().sort();
  } catch {
    return ["one", "other"];
  }
}

/**
 * The base locale's structure against one locale's, for a single key. Returns
 * the human-readable violations; an empty array is a pass.
 */
function structureViolations(key, base, own, locale) {
  const problems = [];
  const sameList = (a, b) => a.join("|") === b.join("|");

  if (base.kind === "message") {
    if (!sameList(base.shape.placeholders, own.shape.placeholders)) {
      problems.push(
        `key "${key}" interpolates {${own.shape.placeholders.join("} {")}}` +
          ` but ${project.baseLocale} interpolates {${base.shape.placeholders.join("} {")}}`,
      );
    }
    if (!sameList(base.shape.tags, own.shape.tags)) {
      problems.push(
        `key "${key}" carries markup [${own.shape.tags.join(" ")}]` +
          ` but ${project.baseLocale} carries [${base.shape.tags.join(" ")}]`,
      );
    }
    if (own.shape.stray.length > 0) {
      problems.push(
        `key "${key}" has a literal "${own.shape.stray.join("")}" in its text —` +
          " the message format reads that as a placeholder (card 101)",
      );
    }
    return problems;
  }

  if (own.declarations !== base.declarations) {
    problems.push(
      `key "${key}" declares ${own.declarations} but ${project.baseLocale} declares` +
        ` ${base.declarations} — declarations name the inputs the call site passes`,
    );
  }
  if (own.selectors !== base.selectors) {
    problems.push(
      `key "${key}" selects on ${own.selectors}, ${project.baseLocale} on ${base.selectors}`,
    );
  }

  const wanted = pluralCategoriesOf(locale).map((c) => `${own.selector}=${c}`);
  const got = [...own.branches.keys()].sort();
  if (!sameList(wanted, got)) {
    problems.push(
      `key "${key}" matches [${got.join(" ")}] but "${locale}" pluralises on` +
        ` [${wanted.join(" ")}] — a number in a category with no branch renders the KEY NAME`,
    );
  }

  const baseOther = base.branches.get(`${base.selector}=other`) ?? { placeholders: [], tags: [] };
  for (const [branch, shape] of own.branches) {
    for (const name of shape.placeholders) {
      if (!base.declarations.includes(`"input ${name}"`)) {
        problems.push(
          `key "${key}" branch ${branch} interpolates {${name}}, which is not a declared input`,
        );
      }
    }
    if (!sameList(baseOther.tags, shape.tags)) {
      problems.push(
        `key "${key}" branch ${branch} carries markup [${shape.tags.join(" ")}]` +
          ` but ${project.baseLocale} carries [${baseOther.tags.join(" ")}]`,
      );
    }
    if (shape.stray.length > 0) {
      problems.push(
        `key "${key}" branch ${branch} has a literal "${shape.stray.join("")}" in its text`,
      );
    }
    // `few`/`many`/`other` each cover an open-ended set of numbers, so a
    // branch that spells the count out as a word or drops it entirely is
    // wrong for every value but the one it was written against. `one`/`two`/
    // `zero` may legitimately read "your only chat" with no number at all.
    const category = branch.slice(branch.indexOf("=") + 1);
    if (!["few", "many", "other"].includes(category)) continue;
    for (const name of baseOther.placeholders) {
      if (!shape.placeholders.includes(name)) {
        problems.push(
          `key "${key}" branch ${branch} drops {${name}} — that category covers many numbers,` +
            " so the value has to appear in it",
        );
      }
    }
  }
  return problems;
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
  // The base locale is NOT skipped: diffed against itself the key sets and
  // placeholder sets are trivially equal, but the literal-brace and
  // plural-category checks are real for it too — `en` gets the same reading
  // as every translation of it.
  if (baseKeys === null) continue;

  for (const [key, base] of baseKeys) {
    const own = keys.get(key);
    if (own === undefined) {
      failures.push(`${rel(file)} — MISSING key "${key}" (present in ${project.baseLocale})`);
    } else if (own.kind !== base.kind) {
      failures.push(
        `${rel(file)} — key "${key}" is a ${own.kind} block but ${project.baseLocale} declares it as ${base.kind}`,
      );
    } else {
      for (const problem of structureViolations(key, base, own, locale)) {
        failures.push(`${rel(file)} — ${problem}`);
      }
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
  console.log(
    "  ok — every locale carries exactly the base locale's key set, the same" +
      "\n       placeholders and markup, and a full set of its own plural categories",
  );
  process.exit(0);
}

console.error(
  `\n  ${failures.length} message-completeness violation(s).` +
    "\n  Every one of these is SILENT at build time (decisions/37): Paraglide" +
    "\n  falls back to the base locale for a missing key, renders a renamed" +
    "\n  placeholder as literal braces, and returns THE KEY NAME for a number" +
    "\n  whose plural category the locale has no branch for. Fix the locale file:\n",
);
for (const f of failures) console.error(`  ${f}`);
console.error("");
process.exit(1);

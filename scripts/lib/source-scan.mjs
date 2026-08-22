// Shared source-scanning primitives for the `npm run guard:*` scripts.
//
// Three of the four guards (`guard-boundaries.mjs`, `guard-throws.mjs`,
// `guard-return-types.mjs`) do the same three things before they can look for
// anything interesting: walk src/, skip the vendored kit, and skip comments so
// a module that EXPLAINS why it no longer does X isn't failed by the guard
// that made that true. `guard-clean-code.mjs` shares the walk (it deliberately
// reads comments — that's where its markers live). This module is the one copy
// of all of it.
//
// These are regexes over source text, with all the bluntness that implies.
// That is a deliberate trade: a guard that a reader can hold in their head and
// that runs in milliseconds beats a type-aware one nobody maintains. Where the
// bluntness matters, the individual guard narrows its own surface.

import { readdir } from "node:fs/promises";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const SRC = path.join(ROOT, "src");

/**
 * Vendored/generated source that is not ours to hold to our rules: the
 * shadcn-svelte kit (regenerable by its CLI), that same generator's `utils.ts`
 * under its other alias (components.json: "utils": "$lib/utils" — it still
 * carries the CLI's own eslint-disable comments), and, ahead of cards 100-105,
 * the paraglide i18n codegen output. Same exclusion as biome.jsonc's
 * `linter.includes`, kept as repo-relative POSIX paths or path prefixes.
 */
export const VENDORED = ["src/ui/components/ui", "src/ui/utils.ts", "src/paraglide"];

/** A repo-relative, forward-slashed path — the form every guard prints. */
export function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

/** True when `relPath` is inside one of the vendored/generated trees above. */
export function isVendored(relPath) {
  return VENDORED.some((v) => relPath === v || relPath.startsWith(`${v}/`));
}

/**
 * True when `relPath` is test code — a spec or a hand-rolled fake/fixture that
 * only tests import. Guards that police PRODUCTION discipline (throwing,
 * explicit return types) skip these: a test asserts with throws by design, and
 * a fixture builder's inferred return type is the fixture's own shape.
 */
export function isTestCode(relPath) {
  return (
    /\.(test|spec)\.[cm]?[jt]s$/.test(relPath) ||
    relPath.includes("/testing/") ||
    relPath.endsWith(".test.svelte")
  );
}

/**
 * Every source file under `dir`, recursively, sorted, excluding the vendored
 * trees. `extensions` is the set of file suffixes to collect (without the dot).
 */
export async function sourceFiles(dir, extensions = ["ts", "js", "mjs", "cjs", "svelte"]) {
  const re = new RegExp(`\\.(${extensions.join("|")})$`);
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (isVendored(rel(full))) continue;
    if (entry.isDirectory()) out.push(...(await sourceFiles(full, extensions)));
    else if (re.test(entry.name)) out.push(full);
  }
  return out.sort();
}

/**
 * A line that is entirely a comment is documentation, not code. Only real code
 * is checked — a module header that says "this used to throw" must not fail the
 * guard that made that true.
 */
export function isCommentOnly(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/**
 * A `.svelte` file's `<script>` bodies, as a line array the same LENGTH as the
 * original file, with every markup line blanked out. Keeping the line numbering
 * means a hit still reports the real line in the real file.
 *
 * Why blank the markup rather than scan the whole file: Svelte markup is prose
 * as often as it is code — a `<p>` explaining that a page's API key is kept in
 * `chrome.storage.local` is syntactically indistinguishable from a call at
 * regex width. Scanning only script blocks is both more precise and easier to
 * explain than a cleverer regex.
 */
export function scriptLinesOnly(source) {
  const lines = source.split("\n");
  const out = new Array(lines.length).fill("");
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of source.matchAll(re)) {
    const startLine = source.slice(0, match.index).split("\n").length - 1;
    const openLines = match[0].slice(0, match[0].indexOf(">") + 1).split("\n").length - 1;
    const body = match[1].split("\n");
    body.forEach((line, i) => {
      out[startLine + openLines + i] = line;
    });
  }
  return out;
}

/**
 * The CODE lines of one file: `.svelte` reduced to its script blocks, comment
 * lines and block-comment bodies blanked, line numbers preserved throughout.
 * Returns an array of `{ line, text }` for the lines that carry code, where
 * `line` is 1-based.
 *
 * Block-comment state is tracked with the same crude rule the boundary guard
 * has used since card 73: a line whose last `/*` is after its last `*&#47;`
 * opens one, and vice versa. It cannot be fooled by anything in this repo, and
 * when it is wrong it is wrong in the safe direction (a guard sees less).
 */
export function codeLines(source, relPath) {
  const lines = relPath.endsWith(".svelte") ? scriptLinesOnly(source) : source.split("\n");
  const out = [];
  let inBlockComment = false;

  lines.forEach((line, i) => {
    const wasInBlockComment = inBlockComment;
    const opens = line.lastIndexOf("/*");
    const closes = line.lastIndexOf("*/");
    if (opens > closes) inBlockComment = true;
    else if (closes > opens) inBlockComment = false;

    if (wasInBlockComment || isCommentOnly(line)) return;
    if (line.trim() === "") return;
    out.push({ line: i + 1, text: line });
  });

  return out;
}

/**
 * `text` with string, template and regex literal CONTENTS blanked out (the
 * quotes stay, so column positions and syntax survive). A guard looking for
 * `throw` must not find the one in the message `"the adapter must not throw"`,
 * and one looking for `):` must not find it inside a URL.
 *
 * Single-line only, which is all the callers need: a template literal spanning
 * lines simply has each of its lines blanked from the opening backtick on.
 */
export function stripLiterals(text) {
  let out = "";
  let quote = null; // the char that opened the current literal, or null
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === null) {
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        out += c;
      } else if (c === "/" && text[i + 1] === "/") {
        break; // rest of the line is a trailing comment
      } else {
        out += c;
      }
    } else {
      if (c === "\\") {
        out += "  ";
        i++;
        continue;
      }
      if (c === quote) {
        quote = null;
        out += c;
      } else {
        out += " ";
      }
    }
  }
  return out;
}

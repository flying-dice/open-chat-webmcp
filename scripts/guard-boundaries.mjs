#!/usr/bin/env node
// Domain purity guard — the half of `npm run guard:boundaries`
// dependency-cruiser structurally cannot do (card 73, decisions/29).
//
// `.dependency-cruiser.cjs` enforces the dependency DIRECTION: what may
// import what, across .ts and .svelte alike. But the most load-bearing rule
// in decisions/29 — "nothing in src/domain/* imports chrome.*, fetch, the
// DOM, or Svelte" — is only half about imports. `chrome`, `fetch`,
// `document`, `window`, `localStorage` and friends are AMBIENT GLOBALS: a
// domain module can reach for any of them without a single import line, and
// dependency-cruiser will report a clean graph while the domain has quietly
// grown a platform dependency. TypeScript won't catch it either, because
// tsconfig.app.json puts `chrome` and the DOM lib in scope for the whole
// project.
//
// So this scans src/domain's source text for those globals directly. It is a
// regex over source, with all the bluntness that implies — hence the
// deliberately narrow surface (only src/domain, only these names, only
// call/member positions) and the escape hatches below.
//
// The bar it defends: a domain module must run in a bare Node test with zero
// mocks of platform APIs (decisions/30's test pyramid is built on that).

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const DOMAIN = path.join(ROOT, "src", "domain");

/**
 * Platform globals a domain module may not touch. Each is matched only where
 * it is actually USED (a call or a member access), never as a bare word — so
 * prose and identifiers like `fetchedAt` or `documentation` don't trip it.
 * The name is what gets printed, so keep it recognisable.
 */
const FORBIDDEN_GLOBALS = [
  { name: "chrome.*", re: /(?<![\w$.])chrome\s*\./g },
  { name: "fetch()", re: /(?<![\w$.])fetch\s*\(/g },
  { name: "XMLHttpRequest", re: /(?<![\w$.])XMLHttpRequest\b/g },
  { name: "document.*", re: /(?<![\w$.])document\s*\./g },
  { name: "window.*", re: /(?<![\w$.])window\s*\./g },
  { name: "navigator.*", re: /(?<![\w$.])navigator\s*\./g },
  { name: "localStorage", re: /(?<![\w$.])localStorage\b/g },
  { name: "sessionStorage", re: /(?<![\w$.])sessionStorage\b/g },
  { name: "indexedDB", re: /(?<![\w$.])indexedDB\b/g },
  { name: "$state/$derived (Svelte runes)", re: /(?<![\w$.])\$(?:state|derived|effect|props)\b/g },
];

/**
 * A line that is entirely a comment is documentation, not code. Domain
 * modules explain WHY a concern was pushed out to an adapter, and saying
 * "this used to call chrome.storage" must not fail the guard that made it
 * true. Only real code is checked.
 *
 * Block-comment bodies are handled by tracking `/* ... *\/` state as we go,
 * so a multi-line module header naming `chrome.permissions` is fine too.
 */
function isCommentOnly(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/** Every .ts/.js/.svelte file under `dir`, recursively. */
async function sourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (/\.(ts|js|svelte)$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

const files = await sourceFiles(DOMAIN);
const violations = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");
  let inBlockComment = false;

  lines.forEach((line, i) => {
    const wasInBlockComment = inBlockComment;
    // Crude but sufficient: a line that opens a block comment and doesn't
    // close it puts us inside one until a line that closes it.
    const opens = line.lastIndexOf("/*");
    const closes = line.lastIndexOf("*/");
    if (opens > closes) inBlockComment = true;
    else if (closes > opens) inBlockComment = false;

    if (wasInBlockComment || isCommentOnly(line)) return;

    for (const { name, re } of FORBIDDEN_GLOBALS) {
      re.lastIndex = 0;
      if (re.test(line)) {
        violations.push({ file: rel, line: i + 1, name, text: line.trim() });
      }
    }
  });
}

console.log(`guard:boundaries — domain purity: scanned ${files.length} file(s) under src/domain`);

if (violations.length === 0) {
  console.log("  ok — no platform globals reached for in src/domain");
  process.exit(0);
}

console.error(
  `\n  ${violations.length} platform-global violation(s) in src/domain.` +
    "\n  The domain must run in a bare Node test with no platform mocks" +
    " (decisions/29, decisions/30)." +
    "\n  Put the concern behind a port and implement it in src/infra/*:\n",
);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.name}`);
  console.error(`      ${v.text}`);
}
console.error("");
process.exit(1);

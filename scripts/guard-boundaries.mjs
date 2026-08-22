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
const SRC = path.join(ROOT, "src");
const DOMAIN = path.join(SRC, "domain");

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
} else {
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
}

// ---------------------------------------------------------------------------
// CONTAINMENT scans (cards 74 and 76)
//
// The domain-purity scan above says where a platform global may NOT be. These
// say where one MAY be: exactly one folder each. Pulling a concern out of
// src/lib and behind a port is not what makes the move stick — the thing that
// makes it stick is that a component can no longer quietly add a
// `chrome.storage.local.set` next to the code that needed it, which is how
// seven of the eleven options components ended up talking to the platform
// directly (decisions/29).
//
// These are globals scans for the same reason the domain one is: `chrome` is
// ambient, so dependency-cruiser cannot see it at all.
// ---------------------------------------------------------------------------

/**
 * Run one containment scan over src/.
 *
 * `detect` decides whether a line is a CALL SITE rather than a mention: it
 * gets each non-comment line and returns a boolean. Comment lines and block
 * comments are skipped for us — a module that explains why it no longer calls
 * an API must not fail the guard that made that true.
 *
 * `exceptions` are sites that are known, named, and owned by a later card:
 * each entry is a file path plus the card that removes it. NOT a general
 * escape hatch — add to one of these lists only alongside a board card that
 * deletes the entry again.
 */
function containmentScan({ api, home, exceptions, detect, fixHint }, allFiles) {
  const files = allFiles.filter(
    (f) => !path.relative(ROOT, f).replaceAll(path.sep, "/").startsWith("src/lib/components/ui/"),
  );
  const found = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file).replaceAll(path.sep, "/");
    if (rel.startsWith(home)) continue;
    if (exceptions.some((e) => e.file === rel)) continue;

    const lines = readFileSync(file, "utf8").split("\n");
    let inBlockComment = false;

    lines.forEach((line, i) => {
      const wasInBlockComment = inBlockComment;
      const opens = line.lastIndexOf("/*");
      const closes = line.lastIndexOf("*/");
      if (opens > closes) inBlockComment = true;
      else if (closes > opens) inBlockComment = false;

      if (wasInBlockComment || isCommentOnly(line)) return;
      if (detect(line)) found.push({ file: rel, line: i + 1, text: line.trim() });
    });
  }

  console.log(
    `guard:boundaries — ${api} containment: scanned ${files.length} file(s) under src/` +
      ` (${exceptions.length} known exception(s))`,
  );

  if (found.length === 0) {
    console.log(`  ok — ${api} is called only from ${home}`);
    return 0;
  }
  console.error(`\n  ${found.length} ${api} call site(s) outside ${home}.\n${fixHint}\n`);
  for (const v of found) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`      ${v.text}`);
  }
  console.error("");
  return found.length;
}

const allSourceFiles = await sourceFiles(SRC);

const containmentViolations =
  containmentScan(
    {
      api: "chrome.storage",
      home: "src/infra/chrome-storage/",
      exceptions: [
        {
          file: "src/sidepanel/stores/panel.svelte.ts",
          why: "the `debug:tab-sync-tracing` runtime flag — card 77 moves it with the rest of the panel store's storage",
        },
      ],
      // `.svelte` markup prose mentions `chrome.storage.local` to tell the
      // user where their API key is kept — that is copy, not a call site.
      detect: (line) =>
        /(?<![\w$.])chrome\s*\.\s*storage\b/.test(line) &&
        /chrome\s*\.\s*storage\s*\.\s*\w+\s*\./.test(line),
      fixHint:
        "  Storage is a driven port (card 74, decisions/29): declare what you\n" +
        "  need on the port in src/domain/<context> and implement it in\n" +
        "  src/infra/chrome-storage/, then reach it through the port:",
    },
    allSourceFiles,
  ) +
  // Card 76. `chrome.identity` is the OAuth sign-in capability, and it is
  // inseparable from the PKCE flow it sits inside — the `state` parameter is
  // generated, sent and re-validated across the one `launchWebAuthFlow` call,
  // so splitting it into src/infra/chrome-runtime would put half of an
  // anti-CSRF check in each folder (src/infra/chrome-runtime/README.md
  // records that call). Containing it to the OAuth adapter is what stops a
  // second, unreviewed sign-in path from appearing next to whatever UI
  // wanted one.
  containmentScan(
    {
      api: "chrome.identity",
      home: "src/infra/mcp/",
      exceptions: [
        {
          file: "src/options/components/McpServerForm.svelte",
          why: "`getRedirectURL()` for the copy-the-redirect-URI field — card 78 takes it as a prop when it de-chromes this component",
        },
      ],
      detect: (line) => /(?<![\w$.])chrome\s*\.\s*identity\s*\.\s*\w/.test(line),
      fixHint:
        "  OAuth is a driven port (card 76, decisions/27, decisions/29): the\n" +
        "  `McpOAuthClient` interface in src/domain/tools is the whole sign-in\n" +
        "  surface, implemented once in src/infra/mcp/oauth.ts. A component\n" +
        "  receives that port; it does not open an auth window itself:",
    },
    allSourceFiles,
  );

if (violations.length > 0 || containmentViolations > 0) process.exit(1);
process.exit(0);

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
// CONTAINMENT scans (cards 74, 76 and 78)
//
// The domain-purity scan above says where a platform global may NOT be. These
// say where one MAY be. Pulling a concern out of a component and behind a port
// is not what makes the move stick — the thing that makes it stick is that a
// component can no longer quietly add a `chrome.storage.local.set` next to the
// code that needed it, which is how seven of the eleven options components
// ended up talking to the platform directly (decisions/29).
//
// These are globals scans for the same reason the domain one is: `chrome` is
// ambient, so dependency-cruiser cannot see it at all. They are also where the
// `app-services` hand-off pattern (src/{sidepanel,options}/app-services.ts)
// pays its own way: an import lint can only see that a store depends on "this
// surface's services", so the thing that actually proves the UI holds no
// platform call is reading the source.
//
// Three scans, widest first:
//
//   chrome.*         may appear only in src/infra/ and the four composition
//                    roots (card 78). This is the card's own success
//                    criterion, and it subsumes the two below for anything
//                    outside src/infra.
//   chrome.storage   inside src/infra, only src/infra/chrome-storage/ (card 74)
//   chrome.identity  inside src/infra, only src/infra/mcp/ (card 76)
//
// The narrow two are kept alongside the wide one on purpose: "chrome.* lives
// in an adapter" and "THIS API lives in THAT adapter" are different promises,
// and only the second stops a second, unreviewed sign-in path appearing in
// whichever adapter happened to want one.
// ---------------------------------------------------------------------------

/**
 * A `.svelte` file's `<script>` bodies, with every other line blanked out so
 * line numbers still line up (card 78).
 *
 * MARKUP IS COPY, NOT CODE. Five components tell the user, in rendered prose,
 * that their API key is kept in `chrome.storage.local` — and that sentence is
 * syntactically indistinguishable from a call. The old `chrome.storage` scan
 * dodged it with a second regex requiring a member access one level deeper;
 * the repo-wide `chrome.*` scan card 78 adds cannot, because at that width
 * every mention looks like a call. Scanning only the script blocks is both
 * more precise and easier to explain than a cleverer regex, and it applies to
 * all three scans.
 */
function scriptLinesOnly(source) {
  const lines = source.split("\n");
  const out = new Array(lines.length).fill("");
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(source)) !== null) {
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
 * Run one containment scan over src/.
 *
 * `homes` is the list of path prefixes where the API is ALLOWED. `detect`
 * decides whether a line is a CALL SITE rather than a mention: it gets each
 * non-comment line and returns a boolean. Comment lines, block comments and
 * `.svelte` markup are skipped for us — a module that explains why it no
 * longer calls an API must not fail the guard that made that true.
 *
 * `exceptions` are sites that are known, named, and owned by a later card:
 * each entry is a file path plus the card that removes it. NOT a general
 * escape hatch — add to one of these lists only alongside a board card that
 * deletes the entry again. Both lists are EMPTY as of card 78, and that is
 * the shape they are meant to stay in.
 */
function containmentScan({ api, homes, exceptions, detect, fixHint }, allFiles) {
  const files = allFiles.filter(
    (f) => !path.relative(ROOT, f).replaceAll(path.sep, "/").startsWith("src/ui/components/ui/"),
  );
  const found = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file).replaceAll(path.sep, "/");
    if (homes.some((home) => rel === home || rel.startsWith(home))) continue;
    if (exceptions.some((e) => e.file === rel)) continue;

    const source = readFileSync(file, "utf8");
    const lines = rel.endsWith(".svelte") ? scriptLinesOnly(source) : source.split("\n");
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

  const where = homes.join(", ");
  console.log(
    `guard:boundaries — ${api} containment: scanned ${files.length} file(s) under src/` +
      ` (${exceptions.length} known exception(s))`,
  );

  if (found.length === 0) {
    console.log(`  ok — ${api} is called only from ${where}`);
    return 0;
  }
  console.error(`\n  ${found.length} ${api} call site(s) outside ${where}.\n${fixHint}\n`);
  for (const v of found) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`      ${v.text}`);
  }
  console.error("");
  return found.length;
}

/**
 * The four composition roots (decisions/29, plus the content script — see
 * `ROOTS` in .dependency-cruiser.cjs for why relay.ts counts as one). A root
 * owns its surface's runtime concerns, and those ARE `chrome.*` calls:
 * message listeners, the side-panel lifecycle, tab events, alarms.
 */
const COMPOSITION_ROOTS = [
  "src/sidepanel/main.ts",
  "src/options/main.ts",
  "src/background/sw.ts",
  "src/content/relay.ts",
];

const allSourceFiles = await sourceFiles(SRC);

const containmentViolations =
  // Card 78 — the widest of the three, and this card's own success criterion:
  // "`grep -rn \"chrome.\" src/` returns hits only under src/infra/, the
  // composition roots and src/content/relay.ts". Before it, twenty of those
  // sites were in a side-panel service, eight in one options form, and five
  // more spread across four other components. Now the UI holds none: it sees
  // domain ports, and a root wires the adapters that implement them.
  //
  // The detector is deliberately blunt — any `chrome.<something>` in a
  // non-comment line of real code — because at this width there is no
  // distinction worth drawing between reading a property, calling a method
  // and naming a `chrome.tabs.Tab` TYPE. All three tie the module to the
  // platform, and a type annotation is exactly how the tab listeners would
  // start creeping back into a store.
  containmentScan(
    {
      api: "chrome.*",
      homes: ["src/infra/", ...COMPOSITION_ROOTS],
      // EMPTY, and the card that would add one has to say what removes it.
      exceptions: [],
      detect: (line) => /(?<![\w$.])chrome\s*\.\s*\w/.test(line),
      fixHint:
        "  The platform is an ADAPTER's business (decisions/29): put the call\n" +
        "  behind a port in src/domain/<context> and implement it in\n" +
        "  src/infra/<tech>/, then let the surface's composition root inject\n" +
        "  it. A runtime concern that genuinely belongs to the surface itself\n" +
        "  (a lifecycle listener, an alarm) goes in that surface's root:",
    },
    allSourceFiles,
  ) +
  containmentScan(
    {
      api: "chrome.storage",
      homes: ["src/infra/chrome-storage/"],
      // EMPTY as of card 77, and meant to stay that way. Card 74 stood this
      // scan up with one exception — the panel store's
      // `debug:tab-sync-tracing` flag, which owned a key, a read and an
      // `onChanged` listener of its own. Card 77 moved those fifteen lines to
      // src/infra/chrome-storage/debug-flags.ts and deleted the entry rather
      // than renewing it, so `chrome.storage` now has exactly one home with no
      // asterisk. Adding an entry here again requires a board card that takes
      // it back out.
      exceptions: [],
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
      homes: ["src/infra/mcp/"],
      // EMPTY as of card 78. Card 76 left one entry here —
      // McpServerForm.svelte's `getRedirectURL()` for the copy-the-redirect-URI
      // field — and this card removed it the way the entry said it would,
      // except better than "take it as a prop": `redirectUri()` is on the
      // `McpOAuthClient` port now, so the panel shows the string the flow
      // actually sends rather than one computed alongside it.
      exceptions: [],
      detect: (line) => /(?<![\w$.])chrome\s*\.\s*identity\s*\.\s*\w/.test(line),
      fixHint:
        "  OAuth is a driven port (card 76, decisions/27, decisions/29): the\n" +
        "  `McpOAuthClient` interface in src/domain/tools is the whole sign-in\n" +
        "  surface, implemented once in src/infra/mcp/oauth.ts, and the ORDER\n" +
        "  its steps happen in is `McpSignIn` (src/domain/tools/sign-in.ts). A\n" +
        "  component receives those ports; it does not open an auth window\n" +
        "  itself:",
    },
    allSourceFiles,
  );

if (violations.length > 0 || containmentViolations > 0) process.exit(1);
process.exit(0);

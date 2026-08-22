#!/usr/bin/env node
// Clean-code guard — `npm run guard:clean-code`
// (decisions/31-clean-code-guard.md, card 73).
//
// The clean-code workflow (the `clean-code-review`, `refactor` and
// `pre-commit` skills) tags violations in place rather than in a tracker:
//
//     // TODO: clean-code - 0.8 - NAMING: `d` says nothing; this is a deadline
//     <!-- TODO: clean-code - 0.3 - DUPLICATION: mirrors ProviderRow.svelte -->
//
// and then asks for "repeated review/refactor passes until clean". Decision
// 31 gives "clean" a mechanical definition so that loop terminates on
// something other than an opinion:
//
//   score  > 0.5  → FAILS the guard, printed with file:line and the marker
//   score <= 0.5  → reported and ALLOWED — documented, accepted debt that
//                   stays visible in the code and in this output rather than
//                   in someone's memory
//
// A marker whose score can't be parsed also fails: decision 31 defines the
// format, and a violation nobody can score is a violation nobody can triage.
// Fixing it is a one-character edit, so this is cheap to comply with.
//
// src/ui/components/ui/ (generated shadcn-svelte source) is excluded — it's
// a vendored kit, not our architecture. Same exclusion as the boundary
// guard's (.dependency-cruiser.cjs).

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

/** Vendored/generated source that is not ours to keep clean (decisions/31). */
const EXCLUDED = [path.join("src", "ui", "components", "ui")];

/** The threshold decision 31 fixes: strictly above this fails. */
const FAIL_ABOVE = 0.5;

/**
 * Both marker forms decision 31 names — `//` in .ts/.svelte script blocks and
 * `<!-- -->` in .svelte markup — plus the block-comment ` * ` continuation, so
 * a marker parked inside a JSDoc block is found too. The score and the rest
 * are captured; the trailing `-->` (if any) is trimmed off the text.
 */
const MARKER = /TODO:\s*clean-code\s*-\s*([^\s-]+)\s*-\s*(.*)$/;

async function sourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full);
    if (EXCLUDED.some((e) => rel === e || rel.startsWith(e + path.sep))) continue;
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (/\.(ts|js|mjs|cjs|svelte|css|html)$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

const files = await sourceFiles(SRC);
const failures = [];
const accepted = [];
const malformed = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const m = MARKER.exec(line);
      if (!m) return;

      const [, rawScore, rest] = m;
      const text = rest.replace(/\s*-->\s*$/, "").trim();
      const found = { file: rel, line: i + 1, score: rawScore, text };
      const score = Number.parseFloat(rawScore);

      if (!Number.isFinite(score)) malformed.push(found);
      else if (score > FAIL_ABOVE) failures.push({ ...found, score });
      else accepted.push({ ...found, score });
    });
}

const total = failures.length + accepted.length + malformed.length;
console.log(
  `guard:clean-code — scanned ${files.length} file(s) under src/` +
    ` (excluding ${EXCLUDED.join(", ")}); ${total} marker(s) found`,
);

if (accepted.length > 0) {
  console.log(`\n  accepted debt (score <= ${FAIL_ABOVE}) — allowed, listed so it stays visible:`);
  for (const a of accepted) console.log(`    ${a.file}:${a.line}  [${a.score}] ${a.text}`);
}

if (malformed.length > 0) {
  console.error(
    "\n  unscored marker(s) — decision 31's format is" +
      " `TODO: clean-code - <score> - <CATEGORY>: <description>`;" +
      " a violation nobody can score is a violation nobody can triage:",
  );
  for (const m of malformed) console.error(`    ${m.file}:${m.line}  [${m.score}] ${m.text}`);
}

if (failures.length > 0) {
  console.error(`\n  ${failures.length} marker(s) above ${FAIL_ABOVE} — these must be fixed:`);
  for (const f of failures) console.error(`    ${f.file}:${f.line}  [${f.score}] ${f.text}`);
}

if (failures.length > 0 || malformed.length > 0) {
  console.error(
    "\n  Run the `refactor` skill (it takes the highest-scored marker first)" +
      " until this guard is green.\n",
  );
  process.exit(1);
}

console.log(`\n  ok — nothing above ${FAIL_ABOVE}\n`);
process.exit(0);

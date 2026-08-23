#!/usr/bin/env node
// Story-coverage guard — `npm run guard:stories`
// (decisions/42-storybook.md, card 123).
//
// Decision 42 asks for "full component coverage": every non-vendored component
// has at least one story. That is a promise nothing keeps on its own — a new
// component compiles, type-checks, passes every other guard and ships with no
// story, and "full" quietly stops being true. This is the check that makes it
// stay true, and it is deliberately the same SHAPE as `guard:i18n`: a set diff
// between two things that must agree, printed per file, with no heuristics in
// between.
//
// WHAT COUNTS AS A COMPONENT
//   The three directories that hold hand-written components:
//     src/sidepanel/components/*.svelte
//     src/options/components/*.svelte
//     src/ui/components/*.svelte
//   Non-recursive on purpose. src/ui/components/ui/** is the VENDORED
//   shadcn-svelte kit — regenerable by its CLI, upstream's to document, and
//   excluded here on exactly the grounds scripts/lib/source-scan.mjs's
//   `VENDORED` list and biome.jsonc's `linter.includes` already exclude it.
//   Decision 42 says so in as many words: "The vendored shadcn kit is excluded
//   — it is upstream's."
//
// WHAT COUNTS AS COVERAGE
//   A COLOCATED `<Name>.stories.svelte` beside `<Name>.svelte`. Colocation is
//   decision 42's choice (the same posture `<Name>.test.ts` already has), and
//   it is what lets this guard be a plain per-directory diff instead of
//   parsing every story file to see which component it imports.
//
// THE ALLOWLIST (scripts/story-allowlist.json)
//   This card stands the pipeline up and writes three proof stories; cards
//   124 and 125 write the rest. So the guard ships SEEDED: every component
//   that has no story TODAY is listed there, and the list is the work those
//   two cards do — each story they add deletes a line, and the file is empty
//   when they are done. Deleting the file entirely is then the last step.
//
//   The allowlist is EXACT, not a floor, the same way
//   scripts/throw-allowlist.json is: an entry for a component that now HAS a
//   story fails as stale, and an entry for a file that no longer exists fails
//   as dangling. Both would otherwise let the list quietly stop describing the
//   tree, which is the only way a temporary allowlist becomes a permanent one.
//
// USAGE
//   node scripts/guard-stories.mjs           check
//   node scripts/guard-stories.mjs --seed    print the allowlist that would
//                                            make the tree pass right now

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { ROOT, rel } from "./lib/source-scan.mjs";

/** The directories that hold hand-written components, repo-relative. */
const COMPONENT_DIRS = ["src/sidepanel/components", "src/options/components", "src/ui/components"];

const ALLOWLIST_PATH = path.join(import.meta.dirname, "story-allowlist.json");

/**
 * Every component file in `dir`, repo-relative and sorted. Non-recursive (see
 * the header), and `.stories.svelte` files are not themselves components.
 */
function componentsIn(dir) {
  const full = path.join(ROOT, dir);
  return readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".svelte") && !name.endsWith(".stories.svelte"))
    .map((name) => `${dir}/${name}`)
    .sort();
}

/** The story file a component would be covered by. */
function storyPathFor(component) {
  return component.replace(/\.svelte$/, ".stories.svelte");
}

/** True when that story file exists on disk. */
function hasStory(component) {
  try {
    readFileSync(path.join(ROOT, storyPathFor(component)));
    return true;
  } catch {
    return false;
  }
}

/**
 * The seeded allowlist. A missing file is not an error — it is the END STATE
 * cards 124/125 are working towards, and the guard simply requires full
 * coverage from that point on.
 */
function readAllowlist() {
  try {
    const json = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
    return new Set(json.uncovered ?? []);
  } catch {
    return new Set();
  }
}

const components = COMPONENT_DIRS.flatMap(componentsIn);
const covered = components.filter(hasStory);
const uncovered = components.filter((c) => !hasStory(c));

if (process.argv.includes("--seed")) {
  console.log(
    JSON.stringify(
      {
        comment:
          "Components with no colocated *.stories.svelte yet (card 123 seeded this;" +
          " cards 124/125 empty it). See scripts/guard-stories.mjs.",
        uncovered,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const allowed = readAllowlist();
const failures = [];

for (const component of uncovered) {
  if (allowed.has(component)) continue;
  failures.push(
    `${component} — no colocated story. Add ${storyPathFor(component)}` +
      " (decisions/42: every non-vendored component has at least one story)",
  );
}

for (const entry of allowed) {
  if (!components.includes(entry)) {
    failures.push(
      `${rel(ALLOWLIST_PATH)} — DANGLING entry "${entry}": no such component.` +
        " Remove the line; the file it excuses is gone",
    );
    continue;
  }
  if (hasStory(entry)) {
    failures.push(
      `${rel(ALLOWLIST_PATH)} — STALE entry "${entry}": it has a story now.` +
        " Remove the line — that is how this list empties",
    );
  }
}

console.log(
  `guard:stories — story coverage: ${covered.length}/${components.length} component(s)` +
    ` across ${COMPONENT_DIRS.length} director(ies), ${allowed.size} awaiting cards 124/125`,
);

if (failures.length === 0) {
  console.log(
    allowed.size === 0
      ? "  ok — every non-vendored component has a colocated story\n"
      : "  ok — every component either has a colocated story or is named in" +
          `\n       ${rel(ALLOWLIST_PATH)}, which cards 124/125 empty\n`,
  );
  process.exit(0);
}

console.error(
  `\n  ${failures.length} story-coverage violation(s). Decision 42 defines "full` +
    '\n  coverage" as every non-vendored component having at least one story, and' +
    "\n  the allowlist is a temporary carve-out for the ones cards 124/125 have not" +
    "\n  reached yet — never a place to park a new component:\n",
);
for (const f of failures) console.error(`  ${f}`);
console.error("");
process.exit(1);

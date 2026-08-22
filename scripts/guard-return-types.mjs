#!/usr/bin/env node
// Explicit-return-type guard — `npm run guard:return-types`
// (decisions/35-biome-and-maximal-strictness.md, card 91).
//
// Decision 35: "every exported function declares its return type; ports and
// interfaces never rely on inference." The point is that a module's PUBLIC
// surface is a contract someone reads, and an inferred return type is a
// contract that changes silently when the body changes — which is exactly what
// decision 34's errors-as-values migration cannot afford, since the whole
// scheme rests on `Result<T, E>` being visible in the signature.
//
// WHY NOT BIOME. Biome 2.5.10 ships `nursery/useExplicitType`, which is (a)
// nursery — "experimental, the behavior can change at any time" — and (b)
// much broader than the decision: it demands an annotation on every function
// including inline callbacks and IIFEs, and on variables too. Turning it on
// would produce hundreds of annotations on one-line `.map()` callbacks whose
// inferred type is right there on the same line, which is noise, not contract.
// This guard implements exactly the decision's rule instead: EXPORTED
// functions, nothing else. Revisit when the Biome rule stabilises and can be
// scoped to exports.
//
// SCOPE
//   * `export function` / `export async function` / `export default function`
//     declarations, and exported `const` arrow functions
//     (`export const f = (...) => ...`, with or without `async`), across
//     src/**/*.ts and the `<script>` blocks of src/**/*.svelte.
//   * Not generators' `yield` types, not class methods (a class's public
//     surface is already anchored by the interface it implements), not
//     overload signatures' implementations.
//   * TEST CODE IS EXCLUDED — `*.test.ts` and anything under `testing/`. A
//     fixture builder's return type IS the fixture's shape; writing it out
//     twice is duplication, not documentation.
//   * The vendored shadcn kit and the paraglide codegen are excluded, as
//     everywhere else (scripts/lib/source-scan.mjs).
//
// This is a regex over source, so it reads only what fits on one line and
// deliberately errs toward silence: a declaration whose parameter list wraps
// is checked on its closing line, and anything it cannot parse it skips rather
// than guessing. `npm run check` is what actually types the code; this guard
// only enforces that the type was WRITTEN DOWN.

import { readFileSync } from "node:fs";
import process from "node:process";
import { SRC, codeLines, isTestCode, rel, sourceFiles, stripLiterals } from "./lib/source-scan.mjs";

/**
 * An exported `function` declaration. Captures the name so the report can
 * point at it. `function*` is included — a generator's declared return type
 * (`AsyncGenerator<...>`) is one of the most useful in this repo.
 */
const EXPORTED_FUNCTION =
  /^export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;

/**
 * An exported arrow-function const with NO type annotation on the const
 * itself: `export const f = (…) => …`.
 *
 * `export const f: ApprovalRequester = …` is deliberately not matched — the
 * annotation on the binding declares the whole contract (parameters and return
 * alike), which is the stronger form of what decision 35 asks for. Repeating
 * the return type inside the arrow would be duplication that can drift.
 */
const EXPORTED_ARROW = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/;

/**
 * Does this declaration line already carry a return type?
 *
 * The annotation sits after the parameter list's closing paren, so: find the
 * paren that closes the FIRST `(` at depth 0 and look for a `:` right after it.
 * Counting parens (rather than matching `):` textually) is what makes
 * `f(cb: () => void): string` come out right.
 *
 * Returns null when the parameter list does not close on this line — the caller
 * then re-tries on the joined continuation, and gives up if that fails too.
 */
function hasReturnType(text) {
  const code = stripLiterals(text);
  const open = code.indexOf("(");
  if (open < 0) return null;

  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0 && c === ")") {
        const after = code.slice(i + 1).trimStart();
        return after.startsWith(":");
      }
    }
  }
  return null; // parameter list continues on a later line
}

const files = await sourceFiles(SRC, ["ts", "svelte"]);
const missing = [];
let checked = 0;

for (const file of files) {
  const relPath = rel(file);
  if (isTestCode(relPath)) continue;

  const source = readFileSync(file, "utf8");
  const lines = codeLines(source, relPath);

  for (let i = 0; i < lines.length; i++) {
    const { line, text } = lines[i];
    const trimmed = text.trim();
    const m = EXPORTED_FUNCTION.exec(trimmed) ?? EXPORTED_ARROW.exec(trimmed);
    if (!m) continue;

    checked++;

    // A declaration whose parameter list wraps is judged on the joined text of
    // the lines up to (and including) the one that closes it.
    let joined = trimmed;
    let verdict = hasReturnType(joined);
    for (let j = i + 1; verdict === null && j < lines.length && j <= i + 12; j++) {
      joined += ` ${lines[j].text.trim()}`;
      verdict = hasReturnType(joined);
    }

    if (verdict === false) missing.push({ file: relPath, line, name: m[1], text: trimmed });
  }
}

console.log(
  `guard:return-types — ${checked} exported function(s) across ${files.length} file(s)` +
    ` under src/ (test code excluded)`,
);

if (missing.length > 0) {
  console.error(`\n  ${missing.length} exported function(s) with no declared return type:\n`);
  for (const v of missing) {
    console.error(`    ${v.file}:${v.line}  ${v.name}`);
    console.error(`        ${v.text}`);
  }
  console.error(
    "\n  Decision 35: a module's public surface is a contract someone reads," +
      "\n  and an inferred return type is a contract that changes silently when" +
      "\n  the body does. Write the type out — especially the Result<T, E> ones.\n",
  );
  process.exit(1);
}

console.log("\n  ok — every exported function declares its return type\n");
process.exit(0);

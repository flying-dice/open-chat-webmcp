// Minimal, loud reporting. A failing assertion is a valuable finding, not
// noise to be summarized away — every failure prints its claim, the reason,
// and any captured detail.
//
// Card 110 added the `selected` filter behind `npm run verify -- --check
// <name>`: a check whose name was not selected is recorded as a SKIP that says
// so, rather than vanishing from the report. A report with no filter behaves
// exactly as before, which is what the smoke scripts in ../checks use.

/**
 * @param {{ selected?: Set<string> | null }} [options] `selected` limits the
 *   run to the named checks (see verify/run.mjs's `--check`). Omit it — as
 *   every caller but run.mjs does — to run everything.
 */
export function createReport({ selected = null } = {}) {
  const results = [];

  /** A check is skipped only by an EXPLICIT filter that doesn't name it; an unnamed check always runs. */
  function isFilteredOut(name) {
    return selected !== null && name !== undefined && !selected.has(name);
  }

  return {
    results,
    async run(claim, fn, name) {
      if (isFilteredOut(name)) {
        results.push({
          claim,
          name,
          status: "SKIP",
          detail: `not selected (--check ${[...selected].join(", ")})`,
          ms: 0,
          filtered: true,
        });
        return;
      }
      const started = Date.now();
      try {
        const detail = await fn();
        results.push({ claim, name, status: "PASS", detail, ms: Date.now() - started });
      } catch (err) {
        results.push({
          claim,
          name,
          status: "FAIL",
          detail: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          ms: Date.now() - started,
        });
      }
    },
    async runBestEffort(claim, fn, name) {
      if (isFilteredOut(name)) {
        results.push({
          claim,
          name,
          status: "SKIP",
          detail: `not selected (--check ${[...selected].join(", ")})`,
          ms: 0,
          filtered: true,
          bestEffort: true,
        });
        return;
      }
      const started = Date.now();
      try {
        const detail = await fn();
        results.push({
          claim,
          name,
          status: "PASS",
          detail,
          ms: Date.now() - started,
          bestEffort: true,
        });
      } catch (err) {
        results.push({
          claim,
          name,
          status: "SKIP",
          detail: err instanceof Error ? err.message : String(err),
          ms: Date.now() - started,
          bestEffort: true,
        });
      }
    },
    print() {
      const line = "=".repeat(78);
      console.log(`\n${line}`);
      console.log("VERIFICATION REPORT");
      console.log(line);
      for (const r of results) {
        const tag = r.status === "PASS" ? "PASS" : r.status === "SKIP" ? "SKIP" : "FAIL";
        const marker = r.bestEffort ? " (best effort)" : "";
        const named = r.name ? `[${r.name}] ` : "";
        console.log(`\n[${tag}]${marker} ${named}${r.claim}  (${r.ms}ms)`);
        if (r.detail) {
          const text = typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail, null, 2);
          for (const ln of text.split("\n")) console.log(`    ${ln}`);
        }
      }
      console.log(`\n${line}`);
      // A check the filter excluded is neither a pass nor a failure — it never
      // ran. Counting it either way would make `--check` look like it had
      // verified (or broken) something it never touched.
      const required = results.filter((r) => !r.bestEffort && !r.filtered);
      const failed = required.filter((r) => r.status === "FAIL");
      const passed = required.filter((r) => r.status === "PASS");
      console.log(`${passed.length}/${required.length} required checks passed.`);
      if (failed.length > 0) {
        console.log(`FAILED CLAIMS: ${failed.map((f) => f.claim).join(", ")}`);
      }
      const filtered = results.filter((r) => r.filtered);
      if (filtered.length > 0) {
        console.log(
          `Ran ${results.length - filtered.length} of ${results.length} checks (--check ${[...selected].join(", ")}); ` +
            `not selected: ${filtered.map((r) => r.name).join(", ")}.`,
        );
      }
      const bestEffort = results.filter((r) => r.bestEffort && !r.filtered);
      for (const be of bestEffort) {
        console.log(`Best-effort: ${be.claim} -> ${be.status}`);
      }
      console.log(`${line}\n`);
      return failed.length === 0;
    },
  };
}

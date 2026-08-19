// Minimal, loud reporting. A failing assertion is a valuable finding, not
// noise to be summarized away — every failure prints its claim, the reason,
// and any captured detail.

export function createReport() {
  const results = [];
  return {
    results,
    async run(claim, fn) {
      const started = Date.now();
      try {
        const detail = await fn();
        results.push({ claim, status: "PASS", detail, ms: Date.now() - started });
      } catch (err) {
        results.push({
          claim,
          status: "FAIL",
          detail: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          ms: Date.now() - started,
        });
      }
    },
    async runBestEffort(claim, fn) {
      const started = Date.now();
      try {
        const detail = await fn();
        results.push({ claim, status: "PASS", detail, ms: Date.now() - started, bestEffort: true });
      } catch (err) {
        results.push({
          claim,
          status: "SKIP",
          detail: err instanceof Error ? err.message : String(err),
          ms: Date.now() - started,
          bestEffort: true,
        });
      }
    },
    print() {
      const line = "=".repeat(78);
      console.log("\n" + line);
      console.log("VERIFICATION REPORT");
      console.log(line);
      for (const r of results) {
        const tag = r.status === "PASS" ? "PASS" : r.status === "SKIP" ? "SKIP" : "FAIL";
        const marker = r.bestEffort ? " (best effort)" : "";
        console.log(`\n[${tag}]${marker} ${r.claim}  (${r.ms}ms)`);
        if (r.detail) {
          const text = typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail, null, 2);
          for (const ln of text.split("\n")) console.log(`    ${ln}`);
        }
      }
      console.log("\n" + line);
      const required = results.filter((r) => !r.bestEffort);
      const failed = required.filter((r) => r.status === "FAIL");
      const passed = required.filter((r) => r.status === "PASS");
      console.log(`${passed.length}/${required.length} required checks passed.`);
      if (failed.length > 0) {
        console.log(`FAILED CLAIMS: ${failed.map((f) => f.claim).join(", ")}`);
      }
      const bestEffort = results.filter((r) => r.bestEffort);
      for (const be of bestEffort) {
        console.log(`Best-effort: ${be.claim} -> ${be.status}`);
      }
      console.log(line + "\n");
      return failed.length === 0;
    },
  };
}

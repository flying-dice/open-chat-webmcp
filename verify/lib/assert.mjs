export function assert(cond, message) {
  if (!cond) throw new Error(message);
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

export function assertSetEqual(actual, expected, message) {
  const a = new Set(actual);
  const e = new Set(expected);
  const missing = [...e].filter((x) => !a.has(x));
  const extra = [...a].filter((x) => !e.has(x));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${message} (missing: [${missing.join(", ")}], extra: [${extra.join(", ")}], got: [${[...a].join(", ")}])`,
    );
  }
}

/** Poll `fn` until `predicate(result)` is true, or throw on timeout. */
export async function pollUntil(fn, predicate, { timeoutMs = 5000, intervalMs = 150, label = "condition" } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for: ${label} (last value: ${JSON.stringify(last)})`);
}

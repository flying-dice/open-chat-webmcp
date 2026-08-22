// Test-only: read the value out of an MCP operation's `Result`, or fail the
// test with the error (card 94, decisions/34-errors-as-values.md) — the
// `McpError` twin of src/infra/chrome-storage/testing/unwrap.ts's
// `StorageError` version. Read that file's header for the full rationale;
// it applies here unchanged, just against a different error vocabulary.
//
// Most suites in this folder are testing FAILURE classification (a 401 maps
// to `kind: "auth"`, a malformed body to `kind: "invalid-response"`, etc.),
// so this helper is reached for less often here than in the storage suites
// — but the handful of genuine happy-path assertions (a well-formed
// `tools/list` result, a successful handshake) still benefit from
// `await unwrap(...)` over repeating the destructure-and-throw dance.
//
// WHAT IT DELIBERATELY IS NOT: not a way to test the FAILURE path — a test
// about a failure must destructure the tuple and assert on the error value
// itself, never `expect(unwrap(...)).rejects`, which would assert on this
// helper's behaviour rather than the port's.
//
// Never imported by production code — only by `*.test.ts` files in this
// folder. It is still real, non-test-suffixed TypeScript, so `npm run check`
// typechecks it like anything else.

import type { Result } from "../../../domain/result";
import type { McpError } from "../../../domain/tools";

/** Await `promise` and return its value, throwing its `McpError` if it failed. For happy-path assertions only — see this module's header. */
export async function unwrap<T>(promise: Promise<Result<T, McpError>>): Promise<T> {
  const [value, err] = await promise;
  if (err) throw err;
  return value;
}

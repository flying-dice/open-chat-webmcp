// Test-only: read the value out of a storage port's `Result`, or fail the
// test with the error (card 92, decisions/34-errors-as-values.md).
//
// WHY THIS EXISTS. Every port in this folder returns
// `Result<T, StorageError>` now, so the ~200 HAPPY-PATH assertions in these
// suites would each have grown two lines of ceremony:
//
//   const [chat, err] = await store.getChat(id);
//   if (err) throw err;
//   expect(chat?.messages).toHaveLength(2);
//
// — where the error check is not the point of the test and its only sensible
// outcome is "this test is broken". This collapses that back to one
// expression, `await unwrap(store.getChat(id))`, so a reader sees the fact
// under test and nothing else. It was written out seven times, once per
// suite in this folder, before being pulled up here.
//
// WHAT IT DELIBERATELY IS NOT. It is not a way to test the FAILURE path — a
// test about a failure must destructure the tuple and assert on the error
// value, never `expect(unwrap(...)).rejects`, because that would be asserting
// on this helper's behaviour rather than on the port's. `throw`ing here is
// exactly the case decision 34 still allows: a violated expectation in code
// whose only correct response is to stop, loudly, naming the cause.
//
// Never imported by production code — only by `*.test.ts` files in this
// folder. It is still real, non-test-suffixed TypeScript, so `npm run check`
// typechecks it like anything else.

import type { Result } from "../../../domain/result";
import type { StorageError } from "../../../domain/storage";

/** Await `promise` and return its value, throwing its `StorageError` if it failed. For happy-path assertions only — see this module's header. */
export async function unwrap<T>(promise: Promise<Result<T, StorageError>>): Promise<T> {
  const [value, err] = await promise;
  if (err) throw err;
  return value;
}

// One identifier generator for this bounded context (card 113).
//
// ./session.ts's `makeChatId` and ./service.ts's `makeMessageId` were
// byte-for-byte the same three lines — the `crypto.randomUUID` feature test
// and the timestamp+random fallback — differing only in the fallback's
// prefix. Two copies of a feature test is two places to get the feature test
// wrong.
//
// The fallback exists because `crypto.randomUUID` is unavailable in
// non-secure contexts and in older runtimes; it is not required to be
// globally unique in the cryptographic sense, only unique among the records
// ONE browser profile holds, which a millisecond timestamp plus 10 random
// base-36 characters comfortably is.

/**
 * A fresh identifier: `crypto.randomUUID()` where available, otherwise
 * `<prefix><timestamp>-<random>`.
 *
 * `prefix` is only ever seen on the fallback path (a UUID has no room for
 * one), so it is a debugging affordance — "which kind of record is this id
 * from" when reading raw storage — never something a caller may parse.
 */
export function newId(prefix = ""): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

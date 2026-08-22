// `Result` — the ONE shape a known failure travels in
// (decisions/34-errors-as-values.md, card 92).
//
// A shared kernel like ./storage, and held to the same rule: it models no
// part of the problem domain, owns no rules, and nothing else may be added
// to it. What it owns is the answer to "how does a function say it can fail
// in a way the caller must handle" — Go/Lua-style, as a VALUE in the return
// type rather than as a `throw` the signature never mentions.
//
// THE SHAPE, AND WHY A TUPLE. A union of two-element tuples rather than a
// `{ok: true, value} | {ok: false, error}` record, because the tuple
// destructures at the call site into two plainly-named locals:
//
//   const [chat, err] = await store.getChat(id);
//   if (err) return report(err);   // `err` is StorageError here…
//   use(chat);                     // …and `chat` is ChatSession, not `| undefined`
//
// That second narrowing is the load-bearing part and it is not free: it
// works because TypeScript 4.6's dependent-destructuring analysis treats
// element 1 as a DISCRIMINANT (`undefined` is a unit type), so a truthiness
// check on `err` narrows the whole tuple and therefore `chat` too. Keep the
// `error` member's `undefined` in the success arm literal and un-widened —
// an `E | undefined` there would stop being a discriminant and silently
// take the narrowing away, leaving every call site with a value it has to
// re-check by hand.
//
// EXACT-OPTIONAL-PROPERTY-TYPES (card 91): tuple ELEMENTS are positional and
// always present, so `exactOptionalPropertyTypes` never applies here — the
// flag governs optional PROPERTIES (`x?: T`), and this type declares none.
// That is deliberate: writing the shape as `{value?: T; error?: E}` would
// have made the flag's absent-vs-explicitly-undefined distinction part of
// the contract, and `ok(undefined)` (a successful read that found nothing)
// would have become unexpressible. A tuple has no such distinction to draw.
//
// `T` may itself include `undefined` — `Result<ChatSession | undefined, E>`
// is the ordinary shape of "a read that succeeded and found nothing" — and
// narrowing still works, because the discriminant is element 1, not
// element 0.
//
// Pure TypeScript — no `chrome.*`, no `fetch`, no DOM, no Svelte, no
// dependencies. Every layer imports it: the domain declares ports in terms
// of it, adapters return it, and the surfaces branch on it.

/** A successful result carrying `value`. The second member is always literally `undefined` — see this module's header on why it must not be widened. */
export type Ok<T> = readonly [value: T, error: undefined];

/** A failed result carrying `error`. The value member is `undefined`: a failure has no value, and saying so is what lets a caller's `if (err)` narrow the value side too. */
export type Err<E> = readonly [value: undefined, error: E];

/**
 * Either a value or an error of the vocabulary `E`, never both and never
 * neither.
 *
 * `E` is a domain error vocabulary (`StorageError`, `ProviderError`,
 * `McpError`, …) — the set of failures the function's author expects and
 * the caller is obliged to handle. A failure that is NOT in `E` is a bug,
 * and a bug is a `throw` (decisions/34).
 */
export type Result<T, E> = Ok<T> | Err<E>;

/**
 * A successful result.
 *
 * `ok()` with no argument is the success of a `Result<void, E>` — a write
 * that landed, with nothing to hand back. `ok(undefined)` is the DIFFERENT
 * thing it looks like: a successful read whose value happens to be
 * `undefined` (`Result<ChatSession | undefined, E>`). Both compile to the
 * same tuple; the type argument is what tells them apart, and the compiler
 * rejects using one where the other is meant.
 */
export function ok<T = void>(value?: T): Ok<T> {
  return [value as T, undefined];
}

/** A failed result. `error` must be a member of the vocabulary the signature declares — an adapter maps the platform's own error into it at the boundary and never lets the original escape (decisions/34). */
export function fail<E>(error: E): Err<E> {
  return [undefined, error];
}

/**
 * Collapse a list of results into one: every value in order, or the FIRST
 * error encountered.
 *
 * Exists because fan-out is where the tuple form is at its most verbose —
 * `Promise.all` over N reads hands back N results, and hand-rolling the
 * "walk them, bail on the first error, otherwise collect" loop at each site
 * is the sort of repetition that eventually gets one site wrong. It is
 * deliberately first-error-wins rather than error-collecting: no caller in
 * this repo shows more than one storage failure at a time, and a
 * `Result<T[], E[]>` would make every one of them index into an array to
 * find the error they were going to report anyway.
 *
 * Note this takes ALREADY-SETTLED results, so a caller still chooses
 * between running its operations concurrently (`allOk(await
 * Promise.all(...))`) and sequentially — the ordering matters for storage
 * writes and is not this helper's to decide.
 */
export function allOk<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const [value, error] of results) {
    if (error) return fail(error);
    // The one place in the kernel that needs a cast, and it is a limit of the
    // narrowing rather than a doubt about the value: dependent destructuring
    // narrows `value` to `T` at a CONCRETE `T`, but here `T` is still an
    // unresolved type parameter, so the checker keeps it at `T | undefined`
    // ("`T` could be instantiated with a type unrelated to `T | undefined`").
    // The `Err` arm was returned one line above, so this is the `Ok` arm and
    // the value is a `T`. Every CALLER of `allOk` gets the real narrowing.
    values.push(value as T);
  }
  return ok(values);
}

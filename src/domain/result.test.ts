// Tests for the shared result kernel (decisions/34-errors-as-values.md).
//
// Half of what this file proves is not a runtime fact at all: the reason
// decision 34 chose a tuple over a `{ok, value, error}` record is that
// `if (err)` narrows BOTH members, and that property lives entirely in the
// type checker. So the narrowing cases below are written as ordinary tests
// that would fail `npm run check` if the narrowing regressed — a `value`
// that stayed `string | undefined` after the error check would not accept
// `.toUpperCase()` — and the negative cases use `@ts-expect-error`, which
// fails the typecheck if the error it expects ever STOPS happening. Between
// them, widening `Ok`'s error member (the one edit that silently kills the
// discriminant) cannot pass.

import { describe, expect, it } from "vitest";
import { allOk, fail, ok, type Err, type Ok, type Result } from "./result";

/** A stand-in error vocabulary — deliberately a class, like `StorageError`, since a class is the shape whose truthiness the narrowing depends on. */
class TestError extends Error {
  readonly kind: "boom";
  constructor(message: string) {
    super(message);
    this.name = "TestError";
    this.kind = "boom";
  }
}

async function loadName(shouldFail: boolean): Promise<Result<string, TestError>> {
  return shouldFail ? fail(new TestError("no name")) : ok("ada");
}

async function loadOptionalName(present: boolean): Promise<Result<string | undefined, TestError>> {
  return present ? ok<string | undefined>("ada") : ok(undefined);
}

async function writeName(shouldFail: boolean): Promise<Result<void, TestError>> {
  return shouldFail ? fail(new TestError("write refused")) : ok();
}

describe("ok / fail construction", () => {
  it("ok(value) puts the value first and undefined second", () => {
    expect(ok("ada")).toEqual(["ada", undefined]);
  });

  it("fail(error) puts undefined first and the error second", () => {
    const error = new TestError("boom");
    expect(fail(error)).toEqual([undefined, error]);
    expect(fail(error)[1]).toBe(error); // the same reference, not a copy
  });

  it("ok() — the void success — is still a two-element tuple, not an empty one", () => {
    expect(ok()).toEqual([undefined, undefined]);
    expect(ok()).toHaveLength(2);
  });

  it("does not confuse a successful read of `undefined` with a failure", () => {
    const [value, error] = ok(undefined);
    expect(value).toBeUndefined();
    expect(error).toBeUndefined();
  });

  it('carries a falsy value through as a success (0, "", false are not failures)', () => {
    for (const falsy of [0, "", false, Number.NaN] as const) {
      const [value, error] = ok<number | string | boolean>(falsy);
      expect(error).toBeUndefined();
      expect(value).toBe(falsy);
    }
  });
});

describe("narrowing — the property the tuple shape exists for", () => {
  it("`if (err)` narrows the ERROR side to E", async () => {
    const [, err] = await loadName(true);
    if (!err) throw new Error("expected a failure");
    // Typed as TestError here, so `.kind` resolves without a cast.
    expect(err.kind).toBe("boom");
    expect(err.message).toBe("no name");
  });

  it("`if (err) return` narrows the VALUE side to T (no `| undefined` left)", async () => {
    const [value, err] = await loadName(false);
    if (err) throw err;
    // `value.toUpperCase()` only typechecks if `value` narrowed to `string`.
    expect(value.toUpperCase()).toBe("ADA");
  });

  it("narrows the same way through indexed access, not just destructuring", async () => {
    const result = await loadName(false);
    if (result[1]) throw result[1];
    expect(result[0].toUpperCase()).toBe("ADA");
  });

  it("keeps `undefined` in T when T declares it — a found-nothing read stays optional", async () => {
    const [absent, absentErr] = await loadOptionalName(false);
    if (absentErr) throw absentErr;
    expect(absent).toBeUndefined();

    const [present, presentErr] = await loadOptionalName(true);
    if (presentErr) throw presentErr;
    // Still needs its own check — narrowing removed the ERROR case, not the
    // legitimately-optional value.
    expect(present?.toUpperCase()).toBe("ADA");
  });

  it("narrows a Result<void, E> — nothing to unpack, everything to check", async () => {
    const [, okErr] = await writeName(false);
    expect(okErr).toBeUndefined();

    const [, failErr] = await writeName(true);
    if (!failErr) throw new Error("expected a failure");
    expect(failErr.message).toBe("write refused");
  });

  it("narrows inside a for-of over a list of results", () => {
    const results: Result<number, TestError>[] = [ok(1), fail(new TestError("bad")), ok(3)];
    const seen: number[] = [];
    for (const [value, error] of results) {
      if (error) continue;
      // `value + 1` only typechecks if `value` narrowed to `number`.
      seen.push(value + 1);
    }
    expect(seen).toEqual([2, 4]);
  });
});

describe("narrowing — negative cases (these fail the typecheck if narrowing ever over-reaches)", () => {
  it("does NOT let the value be used before the error is checked", async () => {
    const [value] = await loadName(false);
    // @ts-expect-error `value` is `string | undefined` until the error member is checked.
    const shouted: string = value.toUpperCase();
    expect(shouted).toBe("ADA");
  });

  it("does NOT let the error be used as E before it is checked", async () => {
    const [, err] = await loadName(true);
    // @ts-expect-error `err` is `TestError | undefined` until it is checked.
    const kind: string = err.kind;
    expect(kind).toBe("boom");
  });

  it("does not treat a void success as carrying a value", () => {
    const result: Ok<void> = ok();
    // @ts-expect-error `Ok<void>`'s value member is `void` — there is nothing to read off it.
    const nothing: string = result[0];
    expect(nothing).toBeUndefined();
  });

  it("does not let an Ok stand in for an Err or vice versa", () => {
    // @ts-expect-error an `Err<E>` never carries a value.
    const bad: Err<TestError> = ok("ada");
    expect(bad[0]).toBe("ada");
  });
});

describe("allOk", () => {
  it("collects every value, in order, when all succeed", () => {
    const [values, err] = allOk<number, TestError>([ok(1), ok(2), ok(3)]);
    if (err) throw err;
    expect(values).toEqual([1, 2, 3]);
  });

  it("returns the FIRST error and no values when one fails", () => {
    const first = new TestError("first");
    const second = new TestError("second");
    const [values, err] = allOk<number, TestError>([ok(1), fail(first), fail(second)]);
    expect(values).toBeUndefined();
    expect(err).toBe(first);
  });

  it("succeeds with an empty list rather than inventing a failure", () => {
    const [values, err] = allOk<number, TestError>([]);
    if (err) throw err;
    expect(values).toEqual([]);
  });

  it("preserves `undefined` values rather than treating them as failures", () => {
    const [values, err] = allOk<string | undefined, TestError>([ok(undefined), ok("ada")]);
    if (err) throw err;
    expect(values).toEqual([undefined, "ada"]);
  });
});

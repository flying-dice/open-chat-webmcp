// Tests for the domain's storage-error vocabulary (decisions/32).
//
// There is a single constructor — `new StorageError(kind, message, options)`
// — rather than one factory per kind, so "every distinct error-kind
// constructor" here means: every value of `StorageErrorKind` produces a
// correctly-tagged instance through that one constructor, and `cause` is
// retained verbatim (not stringified, not dropped) for every kind, since a
// caller may need the original platform failure for logging per this repo's
// port-error convention.

import { describe, expect, it, test } from "vitest";
import { StorageError, type StorageErrorKind } from "./error";

const ALL_KINDS: StorageErrorKind[] = [
  "Unavailable",
  "NotFound",
  "Conflict",
  "Corrupt",
  "Unexpected",
];

describe("StorageError", () => {
  test.each(ALL_KINDS)("constructs with kind=%s set as the discriminant", (kind) => {
    const error = new StorageError(kind, `boom: ${kind}`);
    expect(error.kind).toBe(kind);
  });

  test.each(ALL_KINDS)("is a real Error for kind=%s (instanceof, name, message)", (kind) => {
    const error = new StorageError(kind, "something went wrong");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(StorageError);
    expect(error.name).toBe("StorageError");
    expect(error.message).toBe("something went wrong");
  });

  test.each(ALL_KINDS)("retains a plain-object cause verbatim for kind=%s", (kind) => {
    const cause = { code: "ERR_TEST", detail: "platform-specific failure" };
    const error = new StorageError(kind, "wrapped", { cause });
    expect(error.cause).toBe(cause); // same reference, not a stringified copy
  });

  test.each(ALL_KINDS)("retains an Error cause verbatim for kind=%s", (kind) => {
    // Message text deliberately avoids a literal platform-API-looking
    // substring (e.g. "chrome.runtime.lastError") — guard:boundaries' domain
    // purity scan greps src/domain source TEXT for `chrome.` and can't tell
    // a string literal from a real call, and this file's job is to prove
    // this domain module has none of either.
    const original = new TypeError("storage adapter: quota exceeded");
    const error = new StorageError(kind, "wrapped", { cause: original });
    expect(error.cause).toBe(original);
    expect((error.cause as Error).message).toBe("storage adapter: quota exceeded");
  });

  it("leaves cause undefined when no cause is given, rather than inventing one", () => {
    const error = new StorageError("Unexpected", "no cause supplied");
    expect(error.cause).toBeUndefined();
  });

  it("does not swallow a falsy-but-real cause (e.g. an empty string)", () => {
    const error = new StorageError("Unexpected", "wrapped", { cause: "" });
    expect(error.cause).toBe("");
  });

  it("does not swallow a null cause by coercing it to undefined", () => {
    const error = new StorageError("Unexpected", "wrapped", { cause: null });
    expect(error.cause).toBeNull();
  });

  it("distinguishes two errors of different kinds even with the same message", () => {
    const unavailable = new StorageError("Unavailable", "failed");
    const unexpected = new StorageError("Unexpected", "failed");
    expect(unavailable.kind).not.toBe(unexpected.kind);
  });
});

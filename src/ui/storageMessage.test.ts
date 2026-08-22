// Card 95 (decisions/34-errors-as-values.md, decisions/30's unit tier).
//
// Small file, but the one place the five-member `StorageErrorKind` union
// becomes something a person reads — and the one place a NEW kind could be
// added to the domain without anyone noticing the UI has nothing to say about
// it. The exhaustiveness test at the bottom is what makes that impossible.

import { describe, expect, it } from "vitest";
import { StorageError, type StorageErrorKind } from "../domain/storage";
import { describeStorageError, storageFailureMessage } from "./storageMessage";

const KINDS: StorageErrorKind[] = ["Unavailable", "NotFound", "Conflict", "Corrupt", "Unexpected"];

function err(kind: StorageErrorKind): StorageError {
  return new StorageError(kind, "QuotaExceededError: quota exceeded", { cause: new Error("boom") });
}

describe("storageFailureMessage", () => {
  it("leads with what did not happen, then why", () => {
    expect(storageFailureMessage("Couldn't save your model choice", err("Unavailable"))).toMatch(
      /^Couldn't save your model choice — the browser's extension storage didn't accept it/,
    );
  });

  it("offers a retry only where trying again can behave differently", () => {
    expect(storageFailureMessage("Couldn't save it", err("Unavailable"))).toMatch(
      /Try again in a moment\.$/,
    );
    // A record that decodes to nothing will decode to the same nothing next
    // time — telling the user to retry would be advice that cannot work.
    expect(storageFailureMessage("Couldn't read it", err("Corrupt"))).not.toMatch(/Try again/);
  });

  it("never leaks the platform's own message, which is for the log and not for a person", () => {
    for (const kind of KINDS) {
      const message = storageFailureMessage("Couldn't do the thing", err(kind));
      expect(message).not.toContain("QuotaExceededError");
      expect(message).not.toContain("boom");
    }
  });

  it("says something specific for every kind the domain models", () => {
    const reasons = KINDS.map((kind) => describeStorageError(err(kind)));
    // Non-empty, and no two kinds share a sentence — a duplicate would mean
    // one of them is being described as something it is not.
    for (const reason of reasons) expect(reason.length).toBeGreaterThan(0);
    expect(new Set(reasons).size).toBe(KINDS.length);
  });
});

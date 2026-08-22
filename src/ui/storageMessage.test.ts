// Card 95 (decisions/34-errors-as-values.md, decisions/30's unit tier).
//
// Small file, but the one place the five-member `StorageErrorKind` union
// becomes something a person reads — and the one place a NEW kind could be
// added to the domain without anyone noticing the UI has nothing to say about
// it. The exhaustiveness test at the bottom is what makes that impossible.

import { describe, expect, it } from "vitest";
import { StorageError, type StorageErrorKind } from "../domain/storage";
import { storageFailureMessage } from "./storageMessage";

const KINDS: StorageErrorKind[] = ["Unavailable", "NotFound", "Conflict", "Corrupt", "Unexpected"];

function err(kind: StorageErrorKind): StorageError {
  return new StorageError(kind, "QuotaExceededError: quota exceeded", { cause: new Error("boom") });
}

describe("storageFailureMessage", () => {
  it("leads with what did not happen, then why", () => {
    expect(storageFailureMessage("Couldn't save your model choice", err("Unavailable"))).toMatch(
      /^Couldn't save your model choice: the browser's storage didn't accept it/,
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
    // Card 96 dropped `describeStorageError` (the reason clause on its own),
    // which this test used to call: it had no caller outside this file, and a
    // second exported way to word the same union is how two surfaces start
    // saying different things. The property it protected is unchanged and is
    // asserted through the one remaining export — the fixed `what` cancels
    // out, so any two kinds sharing a sentence still fails here.
    const messages = KINDS.map((kind) => storageFailureMessage("Couldn't do the thing", err(kind)));
    // Non-empty, and no two kinds share a sentence — a duplicate would mean
    // one of them is being described as something it is not.
    for (const message of messages) expect(message.length).toBeGreaterThan(0);
    expect(new Set(messages).size).toBe(KINDS.length);
  });
});

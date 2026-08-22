// User-facing prose for a `StorageError` (card 95,
// decisions/34-errors-as-values.md, decisions/33-shared-ui-layer.md).
//
// src/domain/storage/error.ts states the split this file implements: a
// `StorageError`'s `message` is for a developer reading a log, and "a surface
// that needs user-facing prose builds it from `kind`, which is the part the
// domain models". Cards 92-94 turned every storage failure into a value; card
// 95 is where those values become something a person reads, so the wording
// lives here — once, in the shared UI layer, because both Svelte surfaces show
// the same five kinds and a second copy would drift.
//
// The wording rules, which are why this is prose and not `String(err)`:
//   - never show the platform's own message (a quota `DOMException`'s text is
//     not something a user can act on, and `cause` keeps it for the log);
//   - say what did not happen, then why, then whether retrying helps;
//   - never blame the user's data for what is really a full disk, and never
//     imply a write landed when it did not.

import type { StorageError, StorageErrorKind } from "../domain/storage";

/**
 * Why the store said no, in a clause that reads after an em dash. Deliberately
 * one clause per kind and nothing about WHAT was being saved — the caller
 * supplies that half, since only it knows.
 */
const REASON: Record<StorageErrorKind, string> = {
  Unavailable:
    "the browser's extension storage didn't accept it — it may be full, or the extension may have just been updated or reloaded",
  NotFound: "the record it needed is no longer there",
  Conflict: "something else changed it at the same time",
  Corrupt: "what's stored isn't in a shape this version of the extension understands",
  Unexpected: "the browser's extension storage failed in a way the extension didn't expect",
};

/** Whether it is worth telling the user to try the same thing again. `Corrupt` is not — the same read will decode to the same nothing. */
const RETRYABLE: Record<StorageErrorKind, boolean> = {
  Unavailable: true,
  NotFound: false,
  Conflict: true,
  Corrupt: false,
  Unexpected: true,
};

/** The reason clause on its own — for a caller assembling its own sentence (a form field's inline error, say, where "Couldn't…" would repeat the label). */
export function describeStorageError(err: StorageError): string {
  return REASON[err.kind];
}

/**
 * A complete sentence for a notice, an alert or a form error.
 *
 * `what` names the thing that did not happen, capitalised and without
 * trailing punctuation — "Couldn't save your approval policy", "Couldn't open
 * that chat". Retry advice is appended only for the kinds where trying again
 * can actually behave differently.
 */
export function storageFailureMessage(what: string, err: StorageError): string {
  const suffix = RETRYABLE[err.kind] ? " Try again in a moment." : "";
  return `${what} — ${REASON[err.kind]}.${suffix}`;
}

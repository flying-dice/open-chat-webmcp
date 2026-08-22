// The domain's storage-error vocabulary (card 74,
// decisions/32-storage-ports-and-error-vocabulary.md).
//
// Every driven storage port in this repo — `ChatStore` (src/domain/chat),
// `ProviderRegistry` (src/domain/providers), `McpServerRegistry`
// (src/domain/tools), `SettingsStore` (src/domain/settings) — rejects with
// exactly this type and nothing else. A `chrome.runtime.lastError` string, a
// quota `DOMException`, a `SyntaxError` from a malformed record: an adapter
// maps each of them INTO one of the five kinds below and keeps the original
// on `cause` for logging. Nothing in `src/domain/*` ever sees the platform's
// own error shape (.claude/skills/ddd-hexagonal/SKILL.md, "Driven ports").
//
// It is a THROWN error rather than a result union on purpose: every one of
// these ports already rejected its promise on a storage failure before this
// card, and no caller anywhere handles that rejection — turning them into
// values would have quietly changed every call site's control flow under
// the banner of a behaviour-preserving refactor. The vocabulary is the new
// part; the shape of failure is not.

/**
 * Why a storage operation failed, in the domain's own words.
 *
 * - `Unavailable` — the store could not be reached or would not accept the
 *   write: quota exceeded, the extension context invalidated mid-call, the
 *   `chrome.storage` API itself reporting a `lastError`. Retrying later may
 *   work; the data is not known to be wrong.
 * - `NotFound` — the operation named a record that does not exist, in a
 *   context where absence is an error rather than an ordinary empty read.
 *   (Most reads here return `undefined` for "no such record" instead — that
 *   is not a failure, and adapters must not raise this for it.)
 * - `Conflict` — a concurrent modification lost: the record changed under a
 *   read-modify-write that expected it not to.
 * - `Corrupt` — a record exists but is not the shape the domain models.
 *   Foreign-written, hand-edited, or written by an older shape of this
 *   extension. Reserved for the case where the caller genuinely cannot
 *   proceed; the defensive readers here mostly DROP a malformed record and
 *   carry on, which is deliberate and is not this kind.
 * - `Unexpected` — anything the adapter could not classify. Always carries
 *   its `cause`.
 */
export type StorageErrorKind =
  | "Unavailable"
  | "NotFound"
  | "Conflict"
  | "Corrupt"
  | "Unexpected";

/**
 * The one error every storage port speaks. `cause` keeps whatever the
 * platform threw so a log can name it; `message` is for a developer reading
 * that log, never for a user — a surface that needs user-facing prose builds
 * it from {@link StorageError.kind}, which is the part the domain models.
 */
export class StorageError extends Error {
  readonly kind: StorageErrorKind;

  constructor(kind: StorageErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
    this.kind = kind;
  }
}

/** Narrow an unknown rejection to a {@link StorageError} — for a caller that wants to branch on `kind` rather than just report the failure. */
export function isStorageError(value: unknown): value is StorageError {
  return value instanceof StorageError;
}

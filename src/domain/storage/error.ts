// The domain's storage-error vocabulary (card 74,
// decisions/32-storage-ports-and-error-vocabulary.md).
//
// Every driven storage port in this repo — `ChatStore` (src/domain/chat),
// `ProviderRegistry` (src/domain/providers), `McpServerRegistry`
// (src/domain/tools), `SettingsStore` (src/domain/settings) — reports
// exactly this type and nothing else. A `chrome.runtime.lastError` string, a
// quota `DOMException`, a `SyntaxError` from a malformed record: an adapter
// maps each of them INTO one of the five kinds below and keeps the original
// on `cause` for logging. Nothing in `src/domain/*` ever sees the platform's
// own error shape (.claude/skills/ddd-hexagonal/SKILL.md, "Driven ports").
//
// HOW IT TRAVELS (card 92, decisions/34-errors-as-values.md): as a VALUE, in
// the error member of a `Result<T, StorageError>` (../result). Decision 32
// originally had these ports THROW it, on the grounds that every one of them
// already rejected and no caller handled the rejection — so turning them into
// values would have changed every call site's control flow inside a refactor
// billed as behaviour-preserving. Decision 34 makes exactly that change,
// deliberately and on its own card: a quota failure is an EXPECTED outcome of
// writing to `chrome.storage`, and an expected failure belongs in the
// signature rather than in a comment. The VOCABULARY below is untouched by
// that; only its delivery changed.
//
// It stays an `Error` subclass even though it is no longer thrown — that is
// still the right shape for something carrying a `cause` and a stack, and a
// caller reporting it upward (a `console.error`, a UI notice) has an object
// worth reporting rather than a bare tag.

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
// TODO: clean-code - 0.3 - KISS: two of these five members are unreachable — a repo-wide search for `new StorageError(` finds exactly one construction site (src/infra/chrome-storage/area.ts), which only ever produces "Unavailable" or "Unexpected". "NotFound" and "Conflict" are never constructed anywhere in src/ — premature generality in the domain's own error vocabulary.
export type StorageErrorKind = "Unavailable" | "NotFound" | "Conflict" | "Corrupt" | "Unexpected";

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

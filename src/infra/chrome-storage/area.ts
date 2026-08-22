// The one place `chrome.storage` is actually touched, and the one place its
// failures are translated (card 74, decisions/32-storage-ports-and-error-vocabulary.md).
//
// Every repository in this folder goes through `StorageAreaGateway` rather
// than calling `chrome.storage.local`/`.sync` itself, for one reason: if the
// mapping from a platform failure into `StorageError` lived in each
// repository, there would be four mappings, and three of them would be
// wrong. Here there is one, and a repository's own code reads as if storage
// simply worked or simply didn't.
//
// The promise form of the `chrome.storage` API is used throughout, which
// surfaces what the callback form reports via `chrome.runtime.lastError` as
// a plain rejection — so catching the rejection IS catching `lastError`,
// and neither ever escapes this module.
//
// CARD 92: every method returns `Result<T, StorageError>`
// (decisions/34-errors-as-values.md) rather than throwing one. Decision 32
// chose `throw` here because every caller already rejected and none handled
// it; decision 34 supersedes that — a quota failure or an invalidated
// extension context is an EXPECTED outcome of writing to `chrome.storage`,
// so it belongs in the signature. These four `catch`es are now the whole of
// the mapping: they are the last place a platform exception exists at all,
// and no `throw` leaves this folder.

import { fail, ok, type Result } from "../../domain/result";
import { StorageError, type StorageErrorKind } from "../../domain/storage";

/** Which `chrome.storage` area a key lives in. The credential split (decisions/10, 15) is expressed as a repository choosing one of these per key — see ./keyed-record-store.ts. */
export type StorageAreaName = "local" | "sync";

/**
 * Classify a rejection from `chrome.storage` into the domain's vocabulary.
 *
 * Chrome does not give these errors codes or distinct classes — quota,
 * an invalidated extension context and an internal failure all arrive as an
 * `Error` whose `message` is the only distinguishing feature. So this
 * matches on the message, narrowly, and everything it does not recognise
 * becomes `Unexpected` with the original kept on `cause`. Guessing a
 * specific kind for an unrecognised message would be worse than admitting
 * it is unrecognised: `Unavailable` implies "retry later", and a caller
 * acting on that for something permanent would loop.
 */
function classify(cause: unknown): StorageErrorKind {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  const lower = message.toLowerCase();
  if (
    lower.includes("quota") ||
    lower.includes("max_items") ||
    lower.includes("max_write") ||
    lower.includes("exceeded") ||
    lower.includes("extension context invalidated") ||
    lower.includes("no such storage area") ||
    lower.includes("access to storage is not allowed")
  ) {
    return "Unavailable";
  }
  return "Unexpected";
}

function wrap(area: StorageAreaName, operation: string, cause: unknown): StorageError {
  const detail = cause instanceof Error ? cause.message : String(cause ?? "unknown");
  return new StorageError(
    classify(cause),
    `chrome.storage.${area}.${operation} failed: ${detail}`,
    { cause },
  );
}

/**
 * One `chrome.storage` area, with every failure already mapped into
 * `StorageError`. Deliberately thin — it adds no caching, no batching and no
 * shape validation, because a repository above it needs to be able to reason
 * about exactly which reads and writes happen and in what order (the chat
 * index's read-modify-write, in particular, is only safe because nothing
 * here reorders or coalesces it).
 */
export interface StorageAreaGateway {
  readonly area: StorageAreaName;
  /** The raw stored value for `key`, or `undefined` when the key is absent. Absence is NOT a failure — it is an `ok(undefined)`, and a caller that needs "missing" to be an error raises `NotFound` itself. */
  read(key: string): Promise<Result<unknown, StorageError>>;
  /** Every key/value in the area. Used only where a prefix scan is genuinely required (tab pointers, clear-all); prefer {@link StorageAreaGateway.read}. */
  readAll(): Promise<Result<Record<string, unknown>, StorageError>>;
  write(entries: Record<string, unknown>): Promise<Result<void, StorageError>>;
  /** Removing an absent key is a no-op, not a failure — matching `chrome.storage`. Passing an empty list does nothing at all. */
  remove(keys: string | string[]): Promise<Result<void, StorageError>>;
}

export function createStorageAreaGateway(area: StorageAreaName): StorageAreaGateway {
  // Resolved per call, not captured at construction. Building a gateway must
  // not touch `chrome` at all: `createChromeStoragePorts()` (./ports.ts) builds
  // the whole bundle at module scope, and a module-scope read of
  // `chrome.storage.local` would make merely IMPORTING that file depend on
  // the extension APIs being present — which is exactly what makes an
  // adapter untestable outside a browser (decisions/30's infra tests run
  // against an in-memory fake installed on `globalThis`).
  const chromeArea = () => (area === "sync" ? chrome.storage.sync : chrome.storage.local);

  return {
    area,

    async read(key) {
      try {
        const stored = await chromeArea().get(key);
        return ok(stored[key]);
      } catch (cause) {
        return fail(wrap(area, "get", cause));
      }
    },

    async readAll() {
      try {
        return ok(await chromeArea().get(null));
      } catch (cause) {
        return fail(wrap(area, "get(null)", cause));
      }
    },

    async write(entries) {
      try {
        await chromeArea().set(entries);
        return ok();
      } catch (cause) {
        return fail(wrap(area, "set", cause));
      }
    },

    async remove(keys) {
      if (Array.isArray(keys) && keys.length === 0) return ok();
      try {
        await chromeArea().remove(keys);
        return ok();
      } catch (cause) {
        return fail(wrap(area, "remove", cause));
      }
    },
  };
}

/**
 * Subscribe to `chrome.storage.onChanged` for one key in one area, mapping
 * the raw change to its new value. Returns an unsubscribe function.
 *
 * The listener is filtered by area AND key here rather than by each caller,
 * because a settings subscription that fires on an unrelated key is a bug
 * that only shows up as a spurious re-render much later (decisions/20's
 * "a page-policy change can never fire the MCP callback" is enforced by
 * exactly this filter).
 */
export function subscribeToKey(
  area: StorageAreaName,
  key: string,
  onChange: (newValue: unknown) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ) => {
    if (areaName !== area) return;
    const change = changes[key];
    if (!change) return;
    onChange(change.newValue);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// TODO: clean-code - 0.3 - DRY: this isRecord predicate is reimplemented independently at least nine times across src/ (json-rpc.ts, ollama/client.ts, openai/index.ts, relay.ts, sw.ts, SchemaProperty.svelte, ToolSchema.svelte, ToolArgValue.svelte).
/** `typeof v === "object" && v !== null && !Array.isArray(v)` — the shape check every defensive reader in this folder starts from. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

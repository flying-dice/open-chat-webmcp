// Two small driven ports that used to be src/lib/ollama.ts's private
// storage side-door (card 74: "no module keeps a private storage side-door").
//
// `ollama.ts` kept `ollama:baseUrl` and `ollama:cap:<digest>` in
// `chrome.storage.local` itself, reached for directly from the middle of a
// wire client — the exact mixing of transport and persistence
// decisions/29 called out. Splitting them here does two things: the wire
// client stops touching storage at all (card 75 can move it to
// src/infra/ollama without dragging a repository along), and the two
// concerns get told apart, because they are not one thing:
//
//   - A base URL is CONFIGURATION. It belongs next to the provider settings
//     it is a fallback for, which is why {@link ProviderDefaultsStore} sits
//     in this context alongside `ProviderRegistry` and is keyed by
//     `ProviderType` rather than being Ollama-shaped. A registry entry
//     carries its own `baseUrl` and always wins; this is only what a caller
//     with no registry entry falls back to.
//   - A capability answer is a CACHE. It is derived, disposable, keyed by an
//     opaque model fingerprint, and nothing breaks if it is empty — so it
//     gets its own tiny port ({@link ModelCapabilityCache}) rather than
//     being bolted onto a settings interface that promises to remember what
//     it is told.
//
// Both return `Result<T, StorageError>` (../result, ../storage) — card 92,
// decisions/34-errors-as-values.md. The CACHE is the interesting one: a
// failed `get` and a miss are different values now (`fail(err)` vs
// `ok(undefined)`) even though the caller's response to both is the same
// re-ask, which is precisely the point — the caller says so explicitly
// instead of the distinction being invisible.

import type { Result } from "../result";
import type { StorageError } from "../storage";
import type { ModelCapabilities, ProviderType } from "./provider";

/** Per-provider-type configuration that is not tied to any one registered provider — today just the fallback base URL. */
export interface ProviderDefaultsStore {
  /** The configured fallback base URL for `type`, or `undefined` if none has been set. Callers supply their own default (e.g. `DEFAULT_OLLAMA_BASE_URL`) — the store does not invent one, since it has no idea what a sensible endpoint for a given provider type is. */
  getBaseUrl(type: ProviderType): Promise<Result<string | undefined, StorageError>>;

  /** Persist the fallback base URL for `type`. No trailing slash expected. */
  setBaseUrl(type: ProviderType, baseUrl: string): Promise<Result<void, StorageError>>;
}

/**
 * Cache of {@link ModelCapabilities} keyed by a provider type plus an opaque
 * per-model fingerprint (`ProviderModel.cacheKey` — Ollama's digest).
 *
 * The answer only changes when the model itself changes, which changes the
 * fingerprint, so a hit never needs revalidating. A miss is ordinary and
 * costs one network round trip; the cache never has to be right, only
 * consistent with the fingerprint it was filed under.
 */
export interface ModelCapabilityCache {
  get(
    type: ProviderType,
    fingerprint: string,
  ): Promise<Result<ModelCapabilities | undefined, StorageError>>;
  set(
    type: ProviderType,
    fingerprint: string,
    value: ModelCapabilities,
  ): Promise<Result<void, StorageError>>;
}

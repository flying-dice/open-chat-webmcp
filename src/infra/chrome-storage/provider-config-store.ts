// `chrome.storage.local` implementations of the two small provider-config
// ports (src/domain/providers/config-store.ts) that used to be
// src/lib/ollama.ts's private storage side-door.
//
// Keys are unchanged — `ollama:baseUrl` and `ollama:cap:<digest>` — but they
// are now DERIVED from the provider type rather than hard-coded into a
// module that only ever knew about Ollama: `<type>:baseUrl` and
// `<type>:cap:<fingerprint>`. For `"ollama"` that is byte-identical to what
// was there before, and the next provider type that needs either gets its
// own namespace for free instead of a second private side-door.
//
// Both are LOCAL, not sync. The base URL is very often `localhost`, which is
// meaningless on another machine, and the capability cache is derived data
// keyed by a model fingerprint that is machine-specific too — syncing either
// would push noise at a small quota for no benefit.

import { fail, ok } from "../../domain/result";
import type {
  ModelCapabilities,
  ModelCapabilityCache,
  ProviderDefaultsStore,
  ProviderType,
} from "../../domain/providers";
import { isRecord, type StorageAreaGateway } from "./area";

function baseUrlKey(type: ProviderType): string {
  return `${type}:baseUrl`;
}

function capabilityKey(type: ProviderType, fingerprint: string): string {
  return `${type}:cap:${fingerprint}`;
}

const TOOL_CAPABILITY_STATUSES = ["tool-capable", "no-tools", "unknown"];

export function createChromeStorageProviderDefaultsStore(
  local: StorageAreaGateway,
): ProviderDefaultsStore {
  return {
    async getBaseUrl(type) {
      const [value, err] = await local.read(baseUrlKey(type));
      if (err) return fail(err);
      return ok(typeof value === "string" && value.length > 0 ? value : undefined);
    },

    setBaseUrl: (type, baseUrl) => local.write({ [baseUrlKey(type)]: baseUrl }),
  };
}

export function createChromeStorageModelCapabilityCache(
  local: StorageAreaGateway,
): ModelCapabilityCache {
  return {
    async get(type, fingerprint) {
      const [value, err] = await local.read(capabilityKey(type, fingerprint));
      if (err) return fail(err);
      // A cache miss and an unreadable entry are the same outcome on
      // purpose: the caller re-asks the provider and re-files the answer, so
      // a malformed entry costs one round trip and then repairs itself. A
      // storage FAILURE is not folded in with them (card 92) — the caller
      // recovers the same way, but "the area did not answer" is worth a log
      // line where "this entry is stale" is not.
      return ok(
        isRecord(value) &&
          typeof value.status === "string" &&
          TOOL_CAPABILITY_STATUSES.includes(value.status) &&
          (value.detail === undefined || Array.isArray(value.detail))
          ? // CAST: the conjunction above is the decode — it has just checked
            // every field `ModelCapabilities` declares, on a value that came
            // out of `chrome.storage` as `unknown`. TypeScript does not carry
            // an inline conjunction's narrowing onto a whole-object type, so
            // the assertion states the fact the line above proved. `unknown`
            // is stepped through because `Record<string, unknown>` and
            // `ModelCapabilities` do not overlap enough for a direct one.
            (value as unknown as ModelCapabilities)
          : undefined,
      );
    },

    set: (type, fingerprint, value) => local.write({ [capabilityKey(type, fingerprint)]: value }),
  };
}

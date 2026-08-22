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
      const value = await local.read(baseUrlKey(type));
      return typeof value === "string" && value.length > 0 ? value : undefined;
    },

    async setBaseUrl(type, baseUrl) {
      await local.write({ [baseUrlKey(type)]: baseUrl });
    },
  };
}

export function createChromeStorageModelCapabilityCache(
  local: StorageAreaGateway,
): ModelCapabilityCache {
  return {
    async get(type, fingerprint) {
      const value = await local.read(capabilityKey(type, fingerprint));
      // A cache miss and an unreadable entry are the same outcome on
      // purpose: the caller re-asks the provider and re-files the answer, so
      // a malformed entry costs one round trip and then repairs itself.
      return isRecord(value) &&
        TOOL_CAPABILITY_STATUSES.includes(value.status as string) &&
        (value.detail === undefined || Array.isArray(value.detail))
        ? (value as unknown as ModelCapabilities)
        : undefined;
    },

    async set(type, fingerprint, value) {
      await local.write({ [capabilityKey(type, fingerprint)]: value });
    },
  };
}

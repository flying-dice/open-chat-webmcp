// `chrome.storage` implementation of `ProviderRegistry` (src/domain/providers)
// — decisions/10-provider-registry-and-credential-storage.md,
// decisions/15-custom-headers-are-credentials.md.
//
// The whole CRUD mechanic is ./keyed-record-store.ts, shared with the MCP
// server registry. What is left here is the part that is genuinely about
// PROVIDERS: which fields are credentials, what a stored core entry has to
// look like to be trusted, the default-selection key, and the one rule the
// generic store has no business knowing — removing a provider that is
// currently the default clears the default too.
//
// The credential split, restated because it is the rule that must not
// regress: `providers:list` and `providers:default` are `chrome.storage.sync`.
// `providers:apiKey:<id>` and `providers:headers:<id>` are
// `chrome.storage.local` and are the ONLY place either value is ever
// written. Header VALUES are credentials (decision 15), and there is no
// reason to split a header's name from its value across two areas, so the
// whole array travels together in local.
//
// Both areas are unencrypted at rest (decisions/07, decisions/10) — saying
// so next to the API-key field is the options UI's job, not this module's.

import { fail, ok } from "../../domain/result";
import type {
  ProviderConfigCore,
  ProviderHeader,
  ProviderRegistry,
  ProviderSelection,
  ProviderType,
} from "../../domain/providers";
import { isRecord, type StorageAreaGateway } from "./area";
import { createKeyedRecordStore, credentialPart } from "./keyed-record-store";

const SYNC_KEY_PROVIDERS = "providers:list";
const SYNC_KEY_DEFAULT_SELECTION = "providers:default";
const LOCAL_KEY_API_KEY_PREFIX = "providers:apiKey:";
const LOCAL_KEY_HEADERS_PREFIX = "providers:headers:";

const PROVIDER_TYPES: readonly ProviderType[] = ["ollama", "openai"];

/** The credential fields of a `ProviderConfig`, as the keyed-record store's `parts`. */
interface ProviderCredentials {
  apiKey?: string | undefined;
  headers?: ProviderHeader[] | undefined;
}

// TODO: clean-code - 0.2 - DRY: decodeProviderCore follows the identical isRecord(v) && typeof v.id === "string" && v.id.length > 0 && ... defensive-cast pattern as mcp-server-registry.ts's decodeServerCore, and generateProviderId below mirrors generateServerId (same crypto.randomUUID + fallback, differing only in the prefix literal) — per-record-shape leftovers around keyed-record-store.ts's shared mechanic.
/** Defensive against corrupted/foreign-written storage: drop any entry that doesn't look like a provider config rather than letting it crash a consumer downstream. */
function decodeProviderCore(v: unknown): ProviderConfigCore | undefined {
  if (
    isRecord(v) &&
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.name === "string" &&
    typeof v.baseUrl === "string" &&
    typeof v.type === "string" &&
    (PROVIDER_TYPES as readonly string[]).includes(v.type) &&
    (v.presetId === undefined || typeof v.presetId === "string")
  ) {
    return v as unknown as ProviderConfigCore;
  }
  return undefined;
}

/** Defensive against corrupted/foreign-written storage, mirroring {@link decodeProviderCore}: drop any entry that isn't a clean `{key, value}` pair of strings. */
function isProviderHeader(v: unknown): v is ProviderHeader {
  return (
    isRecord(v) &&
    typeof v.key === "string" &&
    v.key.trim().length > 0 &&
    typeof v.value === "string"
  );
}

/**
 * Defensive against corrupted/foreign-written storage, mirroring
 * {@link decodeProviderCore}'s `v.id.length > 0` check: a `model` that
 * decodes as the empty string was never a real selection made through any
 * current write path (`ProvidersSection.svelte`'s "Set as default" only
 * offers tool-capable model ids from a loaded list; the side panel's
 * `selectModel` only ever writes a model it just resolved capability for) —
 * it can only be leftover, pre-decisions/23 storage from when the options
 * page's now-removed free-text `defaultModel` field was optional and could
 * be left blank (card 97). Treating it as "no selection" here, at the one
 * place both surfaces read `providers:default` back through, means neither
 * surface ever has to guard against probing a provider's capability
 * endpoint with an empty model id (which Ollama's `/api/show` answers with
 * `400 {"error":"model is required"}` — the exact banner card 97 reported).
 */
function isProviderSelection(v: unknown): v is ProviderSelection {
  return (
    isRecord(v) &&
    typeof v.providerId === "string" &&
    typeof v.model === "string" &&
    v.model.length > 0
  );
}

function generateProviderId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `provider-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createChromeStorageProviderRegistry(
  sync: StorageAreaGateway,
  local: StorageAreaGateway,
): ProviderRegistry {
  const records = createKeyedRecordStore<ProviderConfigCore, ProviderCredentials>({
    listKey: SYNC_KEY_PROVIDERS,
    listArea: sync,
    partArea: local,
    decodeCore: decodeProviderCore,
    generateId: generateProviderId,
    parts: {
      apiKey: credentialPart<string>({
        keyPrefix: LOCAL_KEY_API_KEY_PREFIX,
        decode: (raw) => (typeof raw === "string" && raw.length > 0 ? raw : undefined),
        isEmpty: (value) => value.length === 0,
      }),
      headers: credentialPart<ProviderHeader[]>({
        keyPrefix: LOCAL_KEY_HEADERS_PREFIX,
        decode: (raw) => {
          if (!Array.isArray(raw)) return undefined;
          const headers = raw.filter(isProviderHeader);
          return headers.length > 0 ? headers : undefined;
        },
        isEmpty: (value) => value.length === 0,
      }),
    },
  });

  const registry: ProviderRegistry = {
    listProviders: () => records.list(),
    getProvider: (id) => records.get(id),
    addProvider: (input) => records.add(input),
    updateProvider: (id, patch) => records.update(id, patch),

    async removeProvider(id) {
      const [, removeErr] = await records.remove(id);
      if (removeErr) return fail(removeErr);
      // Provider-specific, and deliberately not a hook on the generic store:
      // an MCP server has no equivalent "currently selected" pointer to
      // invalidate (there is no per-chat selected server), so this is one
      // registry's rule, not a shared one. A since-removed provider still
      // referenced by a CHAT is a different case, detected by the domain's
      // `resolveSelection` rather than repaired here.
      const [selection, readErr] = await registry.getDefaultSelection();
      if (readErr) return fail(readErr);
      if (selection?.providerId !== id) return ok();
      return sync.remove(SYNC_KEY_DEFAULT_SELECTION);
    },

    reorderProviders: (orderedIds) => records.reorder(orderedIds),

    async getDefaultSelection() {
      const [value, err] = await sync.read(SYNC_KEY_DEFAULT_SELECTION);
      if (err) return fail(err);
      return ok(isProviderSelection(value) ? value : undefined);
    },

    setDefaultSelection: (selection) => sync.write({ [SYNC_KEY_DEFAULT_SELECTION]: selection }),
  };

  return registry;
}

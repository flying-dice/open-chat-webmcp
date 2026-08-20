// The provider-config registry (decisions/10-provider-registry-and-credential-storage.md,
// decisions/15-custom-headers-are-credentials.md):
// CRUD + reordering over the list of providers a user has configured, the
// active provider+model selection the side panel and agent loop resolve
// against, and dangling-provider detection for a session (or the default
// selection) that references a provider id the user has since deleted.
//
// Storage split (decisions/10, extended by decisions/15): the provider list
// — everything except `apiKey` and `headers` — lives in `chrome.storage.sync`
// under `providers:list`. Each provider's `apiKey`, if any, lives in
// `chrome.storage.local` under `providers:apiKey:<id>`; its custom headers
// (decision 15: header VALUES are credentials, same as `apiKey`) live
// together as one array under `providers:headers:<id>`, keys and values
// alike — there is no reason to split a header's name from its value across
// two stores, only to keep both out of the synced list. Both are merged back
// in on read. Neither field may reach `chrome.storage.sync` — they're the
// two fields every read/write path here routes separately so that can't
// happen by accident.
//
// Both stores are unencrypted at rest (decisions/07, decisions/10) — that's
// the options UI's (card 22) job to state plainly next to the API key field,
// not this module's.

import type { ChatProvider, ProviderHeader, ProviderType } from "../provider";
import { createOllamaProvider } from "./ollama";

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

/**
 * A provider config as the rest of the app sees it (decisions/10, 15).
 * `apiKey` and `headers`, when present, have already been merged in from
 * local storage. `headers` is additive on top of decision 10's original
 * shape — every existing caller that doesn't know about it keeps working
 * unchanged (it's simply `undefined`/absent), per this card's "keep
 * `provider.ts`/`registry.ts` edits additive" instruction.
 */
export interface ProviderConfig {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl: string;
  apiKey?: string;
  /** Custom request headers sent on every call (decision 15). Values are credentials — see {@link ProviderHeader}. Empty/absent means none configured. */
  headers?: ProviderHeader[];
  /**
   * The `ProviderPreset.id` (src/lib/providers/presets.ts) this provider was
   * added from, if any (decisions/21-provider-presets.md). OPTIONAL, and
   * absence is a valid state, not a defect: every provider stored before
   * this card, and every "Custom (OpenAI-compatible)" add, has no
   * `presetId` and must keep loading/editing/saving exactly as before — no
   * migration backfills this field. Purely descriptive (which backend to
   * label a row as, and which preset's fields to re-offer on edit); it
   * never constrains what the other fields can be changed to.
   */
  presetId?: string;
}

/** What actually lives in `chrome.storage.sync` — never carries `apiKey` or `headers` (decision 15: header values are credentials, same rule as `apiKey`). */
type StoredProviderConfig = Omit<ProviderConfig, "apiKey" | "headers">;

const SYNC_KEY_PROVIDERS = "providers:list";
const SYNC_KEY_DEFAULT_SELECTION = "providers:default";
const LOCAL_KEY_API_KEY_PREFIX = "providers:apiKey:";
const LOCAL_KEY_HEADERS_PREFIX = "providers:headers:";

const PROVIDER_TYPES: readonly ProviderType[] = ["ollama", "openai"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Defensive against corrupted/foreign-written storage: drop any entry that doesn't look like a provider config rather than letting it crash a consumer downstream. */
function isStoredProviderConfig(v: unknown): v is StoredProviderConfig {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.name === "string" &&
    typeof v.baseUrl === "string" &&
    typeof v.type === "string" &&
    (PROVIDER_TYPES as readonly string[]).includes(v.type) &&
    (v.presetId === undefined || typeof v.presetId === "string")
  );
}

// ---------------------------------------------------------------------------
// Low-level storage helpers
// ---------------------------------------------------------------------------

async function readStoredList(): Promise<StoredProviderConfig[]> {
  const stored = await chrome.storage.sync.get(SYNC_KEY_PROVIDERS);
  const value = stored[SYNC_KEY_PROVIDERS];
  return Array.isArray(value) ? value.filter(isStoredProviderConfig) : [];
}

async function writeStoredList(list: StoredProviderConfig[]): Promise<void> {
  await chrome.storage.sync.set({ [SYNC_KEY_PROVIDERS]: list });
}

function apiKeyStorageKey(id: string): string {
  return `${LOCAL_KEY_API_KEY_PREFIX}${id}`;
}

async function readApiKey(id: string): Promise<string | undefined> {
  const key = apiKeyStorageKey(id);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Write (or, given `undefined`/`""`, clear) a provider's API key. Always local storage — never synced. */
async function writeApiKey(id: string, apiKey: string | undefined): Promise<void> {
  const key = apiKeyStorageKey(id);
  if (apiKey === undefined || apiKey.length === 0) {
    await chrome.storage.local.remove(key);
  } else {
    await chrome.storage.local.set({ [key]: apiKey });
  }
}

function headersStorageKey(id: string): string {
  return `${LOCAL_KEY_HEADERS_PREFIX}${id}`;
}

/** Defensive against corrupted/foreign-written storage, mirroring {@link isStoredProviderConfig}: drop any entry that isn't a clean `{key, value}` pair of strings rather than letting it crash a consumer downstream. */
function isProviderHeader(v: unknown): v is ProviderHeader {
  return (
    isRecord(v) &&
    typeof v.key === "string" &&
    v.key.trim().length > 0 &&
    typeof v.value === "string"
  );
}

async function readHeaders(id: string): Promise<ProviderHeader[] | undefined> {
  const key = headersStorageKey(id);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  if (!Array.isArray(value)) return undefined;
  const headers = value.filter(isProviderHeader);
  return headers.length > 0 ? headers : undefined;
}

/** Write (or, given `undefined`/`[]`, clear) a provider's custom headers — keys and values together, exactly as entered. Always local storage — never synced (decision 15). */
async function writeHeaders(
  id: string,
  headers: ProviderHeader[] | undefined,
): Promise<void> {
  const key = headersStorageKey(id);
  if (headers === undefined || headers.length === 0) {
    await chrome.storage.local.remove(key);
  } else {
    await chrome.storage.local.set({ [key]: headers });
  }
}

function withSecrets(
  config: StoredProviderConfig,
  apiKey: string | undefined,
  headers: ProviderHeader[] | undefined,
): ProviderConfig {
  return {
    ...config,
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(headers !== undefined ? { headers } : {}),
  };
}

function generateProviderId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `provider-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// CRUD (decisions/10) — options page (card 22) owns the UI on top of these
// ---------------------------------------------------------------------------

/** List every registered provider, in display order, with each `apiKey`/`headers` (if any) merged in from local storage. */
export async function listProviders(): Promise<ProviderConfig[]> {
  const stored = await readStoredList();
  return Promise.all(
    stored.map(async (config) => {
      const [apiKey, headers] = await Promise.all([
        readApiKey(config.id),
        readHeaders(config.id),
      ]);
      return withSecrets(config, apiKey, headers);
    }),
  );
}

/** Look up one provider by id, `apiKey`/`headers` merged in. `undefined` if `id` isn't registered — see {@link resolveProvider} for the "was this deleted" case a session/selection needs. */
export async function getProvider(id: string): Promise<ProviderConfig | undefined> {
  const stored = await readStoredList();
  const config = stored.find((c) => c.id === id);
  if (!config) return undefined;
  const [apiKey, headers] = await Promise.all([readApiKey(id), readHeaders(id)]);
  return withSecrets(config, apiKey, headers);
}

/** Register a new provider. Assigns and returns its `id`. `apiKey` and `headers`, if given, are written to local storage only — neither ever enters the synced list. */
export async function addProvider(
  input: Omit<ProviderConfig, "id">,
): Promise<ProviderConfig> {
  const id = generateProviderId();
  const { apiKey, headers, ...rest } = input;
  const stored = await readStoredList();
  const config: StoredProviderConfig = { ...rest, id };
  await writeStoredList([...stored, config]);
  if (apiKey) await writeApiKey(id, apiKey);
  if (headers && headers.length > 0) await writeHeaders(id, headers);
  return withSecrets(config, apiKey, headers);
}

/**
 * Patch an existing provider. `apiKey` and `headers` — including an
 * explicit `undefined`/`[]` to clear either — are routed to local storage;
 * every other field updates the synced entry. Returns the merged config, or
 * `undefined` if `id` isn't registered.
 */
export async function updateProvider(
  id: string,
  patch: Partial<Omit<ProviderConfig, "id">>,
): Promise<ProviderConfig | undefined> {
  const stored = await readStoredList();
  const index = stored.findIndex((c) => c.id === id);
  if (index === -1) return undefined;

  const { apiKey, headers, ...rest } = patch;
  const updated: StoredProviderConfig = { ...stored[index], ...rest };
  const next = [...stored];
  next[index] = updated;
  await writeStoredList(next);

  if ("apiKey" in patch) await writeApiKey(id, apiKey);
  if ("headers" in patch) await writeHeaders(id, headers);

  const [finalApiKey, finalHeaders] = await Promise.all([
    "apiKey" in patch ? Promise.resolve(apiKey) : readApiKey(id),
    "headers" in patch ? Promise.resolve(headers) : readHeaders(id),
  ]);
  return withSecrets(updated, finalApiKey, finalHeaders);
}

/** Remove a provider and its API key and headers. Also clears it as the default selection if it was set — a since-removed provider referenced by a *tab session* is a separate concern the session owner detects via {@link resolveProvider}. */
export async function removeProvider(id: string): Promise<void> {
  const stored = await readStoredList();
  await writeStoredList(stored.filter((c) => c.id !== id));
  await writeApiKey(id, undefined);
  await writeHeaders(id, undefined);

  const selection = await getDefaultSelection();
  if (selection?.providerId === id) {
    await chrome.storage.sync.remove(SYNC_KEY_DEFAULT_SELECTION);
  }
}

/**
 * Reorder the provider list to match `orderedIds`. `orderedIds` should be a
 * permutation of the current ids; any id it omits is dropped from the
 * stored list — reordering is not a way to delete, so callers should always
 * pass every current id back.
 */
export async function reorderProviders(orderedIds: string[]): Promise<void> {
  const stored = await readStoredList();
  const byId = new Map(stored.map((c) => [c.id, c] as const));
  const reordered = orderedIds
    .map((id) => byId.get(id))
    .filter((c): c is StoredProviderConfig => c !== undefined);
  await writeStoredList(reordered);
}

// ---------------------------------------------------------------------------
// Active provider + model resolution (decisions/10) — used by the side
// panel and agent loop. Per-tab sessions (decisions/07) store the same
// `{ providerId, model }` shape; {@link resolveSelection} works for either.
// ---------------------------------------------------------------------------

/** A provider + model choice, as stored for the global default and for a per-tab session alike. */
export interface ProviderSelection {
  providerId: string;
  model: string;
}

function isProviderSelection(v: unknown): v is ProviderSelection {
  return (
    isRecord(v) &&
    typeof v.providerId === "string" &&
    typeof v.model === "string"
  );
}

/** The user's default provider + model, if one has been set (decisions/10: "exactly one active provider + active model pair is tracked as the default"). */
export async function getDefaultSelection(): Promise<ProviderSelection | undefined> {
  const stored = await chrome.storage.sync.get(SYNC_KEY_DEFAULT_SELECTION);
  const value = stored[SYNC_KEY_DEFAULT_SELECTION];
  return isProviderSelection(value) ? value : undefined;
}

export async function setDefaultSelection(
  selection: ProviderSelection,
): Promise<void> {
  await chrome.storage.sync.set({ [SYNC_KEY_DEFAULT_SELECTION]: selection });
}

/** Result of resolving a provider id that may have been deleted since it was selected. */
export type ProviderResolution =
  | { status: "ok"; config: ProviderConfig }
  | { status: "dangling" };

/**
 * Resolve a provider id, distinguishing a still-registered provider from one
 * the user has since deleted. Callers (the panel, the agent loop) should
 * branch on `status` rather than treating a lookup miss as "not chosen yet"
 * — that's a different state from "chosen, then removed" (decisions/10's
 * dangling-provider case).
 */
export async function resolveProvider(
  providerId: string,
): Promise<ProviderResolution> {
  const config = await getProvider(providerId);
  return config ? { status: "ok", config } : { status: "dangling" };
}

/** Resolution of a full `{ providerId, model }` selection — the shape the panel actually needs to decide what to render. */
export type SelectionResolution =
  | { status: "none" }
  | { status: "dangling"; providerId: string; model: string }
  | { status: "ok"; config: ProviderConfig; model: string };

/**
 * Resolve a `ProviderSelection` (the default selection, or a tab session's
 * selection — same shape either way) into what the panel needs: the live
 * provider config plus the chosen model, or an explicit `"dangling"` state
 * distinct from `"none"` so the panel can prompt for a replacement provider
 * rather than silently failing to send (decisions/10).
 */
export async function resolveSelection(
  selection: ProviderSelection | undefined,
): Promise<SelectionResolution> {
  if (!selection) return { status: "none" };
  const resolved = await resolveProvider(selection.providerId);
  return resolved.status === "ok"
    ? { status: "ok", config: resolved.config, model: selection.model }
    : {
        status: "dangling",
        providerId: selection.providerId,
        model: selection.model,
      };
}

/** Convenience: resolve the global default selection directly. Equivalent to `resolveSelection(await getDefaultSelection())`. */
export async function resolveDefaultSelection(): Promise<SelectionResolution> {
  return resolveSelection(await getDefaultSelection());
}

// ---------------------------------------------------------------------------
// Client construction — dispatches a config to its `ChatProvider` factory
// ---------------------------------------------------------------------------

type ProviderFactory = (config: ProviderConfig) => ChatProvider;

const factories = new Map<ProviderType, ProviderFactory>();

/**
 * Register the client factory for a provider type. Ollama's is registered
 * below, unconditionally, so it works out of the box; card 21's OpenAI
 * client should add its own `registerProviderType("openai", createOpenAiProvider)`
 * call here alongside it once it exists.
 */
export function registerProviderType(
  type: ProviderType,
  factory: ProviderFactory,
): void {
  factories.set(type, factory);
}

/**
 * Build a `ChatProvider` client bound to a resolved config. Throws if
 * `type` has no registered factory — unlike the rest of this module, that's
 * a programming-error path (a provider type whose client was never
 * registered), not a runtime/network failure, so it doesn't go through
 * `ProviderResult`.
 */
export function createProviderClient(config: ProviderConfig): ChatProvider {
  const factory = factories.get(config.type);
  if (!factory) {
    throw new Error(
      `No client registered for provider type "${config.type}".`,
    );
  }
  return factory(config);
}

registerProviderType("ollama", createOllamaProvider);

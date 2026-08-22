// The provider REGISTRY as the domain models it (card 74,
// decisions/10-provider-registry-and-credential-storage.md,
// decisions/15-custom-headers-are-credentials.md): what a configured
// provider IS, what "which provider and model am I using" means, and the
// driven port a surface reaches through to change either.
//
// The sync/local credential split that decisions/10 and 15 mandate is NOT
// modelled here, deliberately: which `chrome.storage` area a field lands in
// is an adapter's concern (src/infra/chrome-storage/provider-registry.ts),
// and the domain's job is only to know that `apiKey` and `headers` ARE
// credentials — which it states by typing them, and which the adapter
// enforces by routing them.
//
// Every port method rejects with `StorageError` (src/domain/storage) and
// nothing else.

import type { ProviderHeader, ProviderType } from "./provider";

/**
 * A provider config as the rest of the app sees it (decisions/10, 15).
 * `apiKey` and `headers`, when present, have already been merged in from
 * wherever the adapter keeps credentials.
 */
export interface ProviderConfig {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl: string;
  /** CREDENTIAL (decisions/10) — never synced. */
  apiKey?: string;
  /** Custom request headers sent on every call (decision 15). Values are CREDENTIALS — see {@link ProviderHeader} — so the whole array is never synced. Empty/absent means none configured. */
  headers?: ProviderHeader[];
  /**
   * The `ProviderPreset.id` (./presets.ts) this provider was added from, if
   * any (decisions/21-provider-presets.md). OPTIONAL, and absence is a valid
   * state, not a defect: every provider stored before that card, and every
   * "Custom (OpenAI-compatible)" add, has none. Purely descriptive (which
   * backend to label a row as, which preset's fields to re-offer on edit);
   * it never constrains what the other fields can be changed to.
   */
  presetId?: string;
}

/** The fields of a {@link ProviderConfig} that are NOT credentials — what may be listed, synced, and reordered freely. */
export type ProviderConfigCore = Omit<ProviderConfig, "apiKey" | "headers">;

/**
 * A provider + model choice, as stored for the global default and for a
 * chat's own selection alike. `model` is expected non-empty — every current
 * writer only ever commits a model it just resolved (ProvidersSection.svelte's
 * "Set as default" picks from a loaded tool-capable list; the side panel's
 * `selectModel` only writes after a capability check). The `providers:default`
 * adapter (src/infra/chrome-storage/provider-registry.ts's `isProviderSelection`)
 * enforces this on read, decoding a stored empty-string `model` as "no
 * selection" rather than a real one — card 97 found a pre-decisions/23
 * leftover in exactly that shape (the options page's now-removed free-text
 * `defaultModel` field was optional and could be saved blank) driving a
 * capability probe with an empty model id straight into Ollama's
 * `400 {"error":"model is required"}`.
 */
export interface ProviderSelection {
  providerId: string;
  model: string;
}

/** Result of resolving a provider id that may have been deleted since it was selected. */
export type ProviderResolution = { status: "ok"; config: ProviderConfig } | { status: "dangling" };

/** Resolution of a full `{ providerId, model }` selection — the shape a picker actually needs to decide what to render. */
export type SelectionResolution =
  | { status: "none" }
  | { status: "dangling"; providerId: string; model: string }
  | { status: "ok"; config: ProviderConfig; model: string };

/**
 * CRUD over the providers a user has configured, plus the global default
 * selection. The driven port for decisions/10's registry.
 */
export interface ProviderRegistry {
  /** Every registered provider, in display order, credentials merged in. */
  listProviders(): Promise<ProviderConfig[]>;

  /** One provider by id, credentials merged in. `undefined` if `id` isn't registered — see {@link resolveProvider} for the "was this deleted" case a selection needs. */
  getProvider(id: string): Promise<ProviderConfig | undefined>;

  /** Register a new provider; assigns and returns its `id`. */
  addProvider(input: Omit<ProviderConfig, "id">): Promise<ProviderConfig>;

  /** Patch an existing provider. An explicit `undefined`/empty `apiKey`/`headers` CLEARS that credential. Returns the merged config, or `undefined` if `id` isn't registered. */
  updateProvider(
    id: string,
    patch: Partial<Omit<ProviderConfig, "id">>,
  ): Promise<ProviderConfig | undefined>;

  /** Remove a provider and its credentials. Also clears it as the default selection if it was set. */
  removeProvider(id: string): Promise<void>;

  /** Reorder to match `orderedIds`. Any id it omits is DROPPED — reordering is not a way to delete, so pass every current id back. */
  reorderProviders(orderedIds: string[]): Promise<void>;

  /** The user's default provider + model, if one has been set (decisions/10: "exactly one active provider + active model pair is tracked as the default"). */
  getDefaultSelection(): Promise<ProviderSelection | undefined>;

  setDefaultSelection(selection: ProviderSelection): Promise<void>;
}

/**
 * Resolve a provider id, distinguishing a still-registered provider from one
 * the user has since deleted. Callers branch on `status` rather than
 * treating a lookup miss as "not chosen yet" — that is a different state
 * from "chosen, then removed" (decisions/10's dangling-provider case).
 *
 * A domain rule over the port, not a port method: nothing about it is
 * storage-specific, and an adapter that reimplemented it could drift from
 * the tri-state {@link resolveSelection} depends on.
 */
export async function resolveProvider(
  registry: ProviderRegistry,
  providerId: string,
): Promise<ProviderResolution> {
  const config = await registry.getProvider(providerId);
  return config ? { status: "ok", config } : { status: "dangling" };
}

/**
 * Resolve a `ProviderSelection` (the global default, or a chat's own — same
 * shape either way) into what a surface needs: the live provider config plus
 * the chosen model, or an explicit `"dangling"` state distinct from
 * `"none"`, so the panel can prompt for a replacement provider rather than
 * silently failing to send (decisions/10).
 */
export async function resolveSelection(
  registry: ProviderRegistry,
  selection: ProviderSelection | undefined,
): Promise<SelectionResolution> {
  if (!selection) return { status: "none" };
  const resolved = await resolveProvider(registry, selection.providerId);
  return resolved.status === "ok"
    ? { status: "ok", config: resolved.config, model: selection.model }
    : {
        status: "dangling",
        providerId: selection.providerId,
        model: selection.model,
      };
}

/**
 * Whether a resolved selection is safe to act on right now: a live provider
 * actually resolved (`status === "ok"`, ruling out `"none"`/`"dangling"`)
 * AND not sitting in decisions/35's needs-confirmation state (the model
 * list moved out from under a stale selection and the user hasn't
 * re-confirmed it). Three sidepanel call sites re-derived this
 * independently — App.svelte's send guard, Composer.svelte's `blocked`
 * state, and ProviderPicker.svelte's trigger label — before this became the
 * one place the rule lives (card 90).
 */
export function isSelectionUsable(
  resolution: SelectionResolution,
  needsConfirmation: boolean,
): resolution is { status: "ok"; config: ProviderConfig; model: string } {
  return resolution.status === "ok" && !needsConfirmation;
}

// TODO: clean-code - 0.3 - SRP: combines provider-list loading, per-provider model-loading/capability resolution, and selection persistence with an unrelated picker open/close UI toggle (pickerOpen/openPicker/closePicker).
// Provider + model selection for the side panel's picker (card 23, flattened
// by card 51 per decisions/22-flat-model-picker.md, decisions/10-provider-registry-and-credential-storage.md,
// decisions/11-provider-capability-detection.md).
//
// This is the ONE place the panel resolves "which provider, which model,
// is it actually safe to send tools to it" — the agent-loop card (cards
// 08/09, built separately) is expected to read `selection.resolution` to
// get a live `ProviderConfig` + model id (feed straight into
// `createProviderClient`/`chat`), and `selection.activeCapability` to
// decide whether to attach page tools to the request at all: only
// `"tool-capable"` should ever get tools; `"no-tools"` and `"unknown"`
// mean "don't attach tools" (decisions/11 — an `"unknown"` model is not a
// confirmed "yes").
//
// State model:
//   - `resolution`: the PERSISTED selection for the active tab's session
//     (decisions/07, decisions/10) — "none" (nothing chosen yet), "dangling"
//     (chosen, then the provider was deleted), or "ok" (a live provider +
//     model). This is what the agent loop should read.
//   - `modelsByProvider`: EVERY registered provider's model list, loaded in
//     PARALLEL and degrading PER PROVIDER (decisions/22's consequences: "one
//     unreachable backend greys its own group and never blocks the others" —
//     the same discipline decisions/19 §4 applies to MCP server discovery,
//     src/sidepanel/services/mcpTools.ts's `refreshNow`/`ensureMcpDiscoveryFresh`).
//     Card 23's two-level "browse one provider at a time" concept is gone:
//     the flat picker (ProviderPicker.svelte) needs every provider's list at
//     once to build its grouped view, so this module fetches all of them.
//
// PER-PROVIDER DEGRADATION: each provider's load is tracked by its own
// monotonic token in `providerTokens`, not a single shared one. A shared
// token (like card 23's `modelsRequestToken`) would mean retrying ONE
// provider bumps the generation for ALL of them, silently discarding
// still-in-flight loads for providers that were never asked to reload —
// exactly the "one slow backend blocks/cancels the others" failure this
// card exists to avoid. `loadModelsForProvider` is otherwise a straight
// per-provider generalisation of card 23's single `loadModels`.
//
// SINGLE OWNER (card 27, boards/project-backlog/27-selection-store-stale-session-write.md):
// this module used to hold its own private `ChatSession` copy just to
// read/write the `selection` field, loaded independently of the live copy the
// agent loop appends messages to. That second copy going stale — it never saw
// messages appended through the other one — is exactly what let
// `selectModel()` silently overwrite history with an emptier snapshot the
// moment the user changed provider/model mid-conversation.
//
// The fix: this module no longer loads or holds a `ChatSession` at all. It
// reads and writes only the `selection` field, through `ChatService`'s
// `getSelection`/`setSelection` (src/domain/chat), which operate on the SAME
// live object every other mutator writes to.
//
// ONE CONCEPT, ONE STORE (card 77). Until this card those two functions lived
// in src/sidepanel/stores/panel.svelte.ts — so the selection concept was split
// across two stores, and the store that displayed a chat also owned the rule
// for persisting the OTHER store's field. The persistence itself belongs on
// the chat's own record (it IS `ChatSession.selection`, read back on every tab
// switch and carried across a new chat), so it stayed on the aggregate and
// moved behind the `ChatStore` port with everything else; what moved HERE is
// the only part that was ever selection's: knowing when to read it, when to
// seed it, and whether the user actually chose it. Card 35's explicit flag
// (`selectionExplicit`) is now a declared field on `ChatSession` rather than a
// cast-on boolean, and this module holds the reactive copy the composer reads.

import {
  describeProviderError,
  isSelectable,
  resolveCapabilities,
  resolveCapability,
  resolveSelection,
  type ChatProvider,
  type ModelCapabilities,
  type ProviderConfig,
  type ProviderError,
  type ProviderModel,
  type ProviderSelection,
  type SelectionResolution,
} from "../../domain/providers";
import { chat, sidePanelServices } from "../app-services";

export type { SelectionResolution } from "../../domain/providers";

/** One row in a provider's model list, with its capability lookup resolved (or still in flight — see the doc comment on `capability` below). */
export interface ModelListEntry {
  model: ProviderModel;
  /**
   * `undefined` while the per-model capability check is still in flight.
   * In practice this is never observed by a consumer of `ModelsState`:
   * `loadModelsForProvider` only flips a provider to `"loaded"` once every
   * entry's capability lookup has resolved (`resolveCapabilities` awaits
   * `Promise.all` first), so `capability` is always defined by the time UI
   * reads a `"loaded"` provider's entries. The type stays optional as a
   * defensive fallback for any future caller that doesn't go through that
   * path — grouping logic should treat `undefined` the same as `"unknown"`
   * (never as `"tool-capable"`), never silently drop the row.
   */
  capability: ModelCapabilities | undefined;
}

/** State of one provider's model list. */
export type ModelsState =
  | { status: "loading" }
  | { status: "loaded"; entries: ModelListEntry[] }
  /**
   * The provider's `listModels()` failed outright (unreachable, auth, etc.)
   * — distinct from "loaded with zero tool-capable entries". `error` is the
   * raw `ProviderError` alongside `message` (its prose form) so the picker
   * can branch on `.kind` for a kind-specific fix — a copyable CORS command,
   * an "open options" shortcut for an auth failure — the same vocabulary
   * card 22's options-page UI already keys off (src/options/forms/testResultDisplay.ts),
   * never a second one invented here (card 14). decisions/22's consequences:
   * this is what the picker now has to surface on the PROVIDER'S GROUP
   * HEADING, since the two-level picker's provider `<select>` — the only
   * other place this was ever shown prominently — is gone.
   */
  | { status: "error"; message: string; error: ProviderError }
  /**
   * The provider has no model-listing API (`ProviderError.kind === "not-supported"`,
   * e.g. some OpenAI-compatible hosts) — the picker falls back to letting the
   * user type a model id, per `src/domain/providers/provider.ts`'s `listModels` doc comment.
   */
  | { status: "not-supported"; message: string; manualEntry: ModelListEntry | undefined };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// TODO: clean-code - 0.15 - COUPLING: eight independent module-level $state fields plus a non-reactive providerTokens map are mutated by overlapping functions (syncToTab, loadProviders, loadModelsForProvider, selectModel, refresh) with implicit ordering assumptions — a wide surface to hold in your head to change one function safely.
let tabId = $state<number | undefined>(undefined);
let origin = $state<string>("");

let providers = $state<ProviderConfig[]>([]);
let providersStatus = $state<"loading" | "loaded" | "error">("loading");

let resolution = $state<SelectionResolution>({ status: "none" });

/**
 * Card 35: whether the resolved selection was set by a DELIBERATE user action
 * rather than silently seeded from the stored global default. Mirrored here
 * from `ChatSession.selectionExplicit` on every {@link syncToTab} and set by
 * {@link selectModel}, so the composer's gate is a plain reactive read rather
 * than a second store's getter. A `startNewChat` carries the flag over with
 * the selection itself (src/domain/chat/service.ts), which is why this does
 * NOT reset when a fresh chat starts — a choice the user already confirmed
 * stays confirmed.
 */
let selectionExplicit = $state(false);

/** Every registered provider's model list, keyed by provider id — loaded in parallel, degrading per provider (see this module's header comment). Absent key = never (yet) requested. */
let providerModelsState = $state<Record<string, ModelsState>>({});

/**
 * Per-provider load generation, guarding against a stale async response
 * landing after a NEWER load for that SAME provider has started (e.g. two
 * quick "Retry" clicks). Deliberately one token per provider id, not one
 * shared token: reloading provider A must never invalidate an in-flight
 * load for provider B. Not `$state` — this is internal bookkeeping the UI
 * never reads directly.
 */
const providerTokens: Record<string, number> = {};

/**
 * Card 35/36: the picker popover's own open/close state, lifted out of
 * ProviderPicker.svelte (which still owns the click-outside/Escape wiring)
 * so Composer.svelte's blocked-composer empty state (card 35's "route to
 * the picker in one click") can open the SAME popover instance mounted in
 * the header, rather than each component owning an independent one that
 * could disagree about whether it's open.
 */
let pickerOpen = $state(false);

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

function findProvider(id: string | undefined): ProviderConfig | undefined {
  return id === undefined ? undefined : providers.find((p) => p.id === id);
}

function entriesFor(providerId: string): ModelListEntry[] {
  const state = providerModelsState[providerId];
  if (!state) return [];
  if (state.status === "loaded") return state.entries;
  if (state.status === "not-supported" && state.manualEntry) return [state.manualEntry];
  return [];
}

export const selection = {
  /** Registered providers, in display order. Empty + `providersStatus === "loaded"` is the "no providers registered" empty state. */
  get providers(): ProviderConfig[] {
    return providers;
  },
  get providersStatus(): "loading" | "loaded" | "error" {
    return providersStatus;
  },
  /** The persisted `{providerId, model}` for the active tab's session, resolved against the live registry. The agent loop should read this to get a `ProviderConfig` + model to call. */
  get resolution(): SelectionResolution {
    return resolution;
  },
  /** Every provider's model-list state, keyed by provider id (decisions/22: the flat picker needs all of them at once, loaded in parallel and degrading independently — see this module's header comment). ProviderPicker.svelte builds its per-provider groups plus the Unverified/No-tool-support buckets from this. */
  get modelsByProvider(): Record<string, ModelsState> {
    return providerModelsState;
  },
  /** Tool-capability of the currently *selected* (persisted) model, if resolved. The agent loop should only attach page tools when this is `"tool-capable"` (decisions/11). */
  get activeCapability(): ModelCapabilities | undefined {
    const r = resolution;
    if (r.status !== "ok") return undefined;
    return entriesFor(r.config.id).find((e) => e.model.id === r.model)?.capability;
  },
  /**
   * Card 35: there IS a resolved provider+model (`resolution.status ===
   * "ok"`), but it was silently seeded from the stored default rather than
   * deliberately chosen for this chat (`selectionExplicit` is `false`) — the
   * "one-click confirm" state. Composer.svelte gates
   * sending on `resolution.status === "ok" && !needsConfirmation`, not on
   * `resolution.status === "ok"` alone.
   */
  get needsConfirmation(): boolean {
    return resolution.status === "ok" && !selectionExplicit;
  },
  /** Card 35/36's shared picker popover open state — see `pickerOpen`'s doc comment. */
  get pickerOpen(): boolean {
    return pickerOpen;
  },
};

// ---------------------------------------------------------------------------
// Loading providers + the tab's session
// ---------------------------------------------------------------------------

/** Kick off a load for any registered provider that doesn't have a model-list state yet — idempotent, safe to call on every sync. Providers already loaded (or loading) are left alone; use {@link reloadModels} or {@link refresh} to force a re-fetch. */
function ensureModelsLoaded(): void {
  for (const p of providers) {
    if (!(p.id in providerModelsState)) void loadModelsForProvider(p);
  }
}

async function loadProviders(): Promise<void> {
  providersStatus = "loading";
  // Card 92: the `try/catch` this replaces existed for exactly one failure —
  // the registry read rejecting — and the tuple says so. The recovery is
  // unchanged: empty list, `"error"` status, which is what the picker renders
  // its "couldn't load providers" state from.
  const [loaded, err] = await sidePanelServices().providers.listProviders();
  if (err) {
    providers = [];
    providersStatus = "error";
    return;
  }

  providers = loaded;
  providersStatus = "loaded";

  // Drop model-list state for providers that no longer exist, so a
  // deleted provider can't leave a stale group behind if it's ever
  // re-added under a reused id.
  const liveIds = new Set(providers.map((p) => p.id));
  for (const id of Object.keys(providerModelsState)) {
    if (!liveIds.has(id)) delete providerModelsState[id];
  }

  ensureModelsLoaded();
}

/**
 * Point the store at a tab: resolves its persisted selection (reading it
 * off the chat service's live session for `newTabId` — see this module's
 * header comment). Call whenever the panel's active tab changes (including
 * the initial mount) — safe to call repeatedly for the same `tabId`.
 *
 * Unlike card 23's two-level picker, this no longer needs to pick a
 * "browsing" provider per tab — every provider's models are loaded once
 * (via `ensureModelsLoaded`, inside `loadProviders`) and reused across tab
 * switches; only `resolution` (which model is highlighted as active) is
 * per-tab.
 *
 * Relies on the chat service having already loaded (or created) `newTabId`'s
 * chat by the time this runs — true for this store's one caller
 * (`ProviderPicker.svelte`'s effect on `panel.pageInfo`), since
 * src/infra/chrome-runtime/tab-sync.ts's `refreshActiveTab` always awaits
 * the session's `syncToTab`
 * before setting `pageInfo`. If that ever isn't true yet (session not
 * loaded for this tab), `chat.getSelection` returns `undefined` and this
 * resolves to `"none"` rather than guessing — a transient display gap, not
 * a lost write, and it self-corrects on the next sync.
 */
export async function syncToTab(newTabId: number, newOrigin: string): Promise<void> {
  const changedTab = tabId !== newTabId || origin !== newOrigin;
  tabId = newTabId;
  origin = newOrigin;

  if (providersStatus === "loading" || changedTab) {
    await loadProviders();
  } else {
    ensureModelsLoaded();
  }

  // A default that cannot be READ is treated as no default at all: the tab
  // simply starts with nothing selected and the composer asks the user to
  // pick, which is the same state a fresh profile is in. `loadProviders`
  // above has already surfaced the read failure as `providersStatus`.
  const [defaultSelection] = await sidePanelServices().providers.getDefaultSelection();

  // Seed a brand-new chat with the global default the first time this tab is
  // seen — but write it through the chat service's live session (never a
  // private copy): `setSelection` no-ops harmlessly if no chat is loaded for
  // this tab yet, and is idempotent once one is (a later run sees the
  // selection already set and skips the write).
  let stored = chat().getSelection(newTabId);
  if (stored === undefined && defaultSelection) {
    // Card 35: this is the exact "resolve implicitly from a stored default"
    // path the card is unhappy about — `explicit: false` records that so the
    // composer knows to ask for a one-click confirmation before the first
    // message, rather than treating this silent seed as good enough.
    const applied = await chat().setSelection(newTabId, defaultSelection, false);
    if (applied) stored = { selection: defaultSelection, explicit: false };
  }

  selectionExplicit = stored?.explicit === true;
  const [resolved, resolveErr] = await resolveSelection(
    sidePanelServices().providers,
    stored?.selection,
  );
  // `"none"` on a failed read, for the same reason as the default above: the
  // picker's "none" state prompts for a choice, whereas `"dangling"` would
  // claim the user's provider had been DELETED, which is a different and
  // wrong thing to tell them about a store that merely didn't answer.
  resolution = resolveErr ? { status: "none" } : resolved;
}

// ---------------------------------------------------------------------------
// Per-provider model loading (decisions/22: parallel, degrading per provider)
// ---------------------------------------------------------------------------

// TODO: clean-code - 0.3 - DRY: buildClient (try createProviderClient, catch -> undefined) is duplicated verbatim in src/options/components/ProvidersSection.svelte instead of being shared.
function buildClient(config: ProviderConfig): ChatProvider | undefined {
  try {
    return sidePanelServices().createProviderClient(config);
  } catch {
    // No factory registered for this provider's type (registry.ts: a
    // programming-error path, e.g. a self-registering module — see
    // src/lib/providers/openai.ts — that was never imported for this
    // entry point). Surface as a plain error rather than throwing through
    // the picker.
    return undefined;
  }
}

/**
 * Load (or reload) ONE provider's model list, writing only that provider's
 * slot in `providerModelsState`. This is the unit of "degrade per
 * provider": callers fire this once per provider without awaiting each
 * other (`ensureModelsLoaded`, `refresh`), so a slow or unreachable
 * provider's `await client.listModels()` never delays another provider's
 * write to `providerModelsState` — each provider's group in the picker
 * updates the moment ITS OWN fetch settles, independent of the rest.
 *
 * Guarded by `providerTokens[config.id]` rather than a single shared token
 * (see this module's header comment) so retrying provider A can never
 * discard an in-flight load for provider B.
 */
// TODO: clean-code - 0.45 - DRY: duplicates at length the same per-provider-token-guarded "listModels -> branch on error kind -> resolveCapabilities -> filter selectable" sequence as src/options/components/ProvidersSection.svelte's loadDefaultModelOptions, instead of sharing an extracted helper.
async function loadModelsForProvider(config: ProviderConfig): Promise<void> {
  const token = (providerTokens[config.id] ?? 0) + 1;
  providerTokens[config.id] = token;
  providerModelsState[config.id] = { status: "loading" };

  const client = buildClient(config);
  if (!client) {
    // Programming-error path (registry.ts: no factory registered for this
    // provider type), not an actual `ProviderError` from a client — there
    // is no real "kind" to report, so this is the closest honest fit
    // rather than fabricating a network/auth failure that didn't happen.
    const message = `No client is registered for provider type "${config.type}".`;
    if (providerTokens[config.id] !== token) return;
    providerModelsState[config.id] = {
      status: "error",
      message,
      error: { kind: "invalid-response", message },
    };
    return;
  }

  const result = await client.listModels();
  if (providerTokens[config.id] !== token) return; // superseded by a later reload for this provider

  if (!result.ok) {
    if (result.error.kind === "not-supported") {
      providerModelsState[config.id] = {
        status: "not-supported",
        message: describeProviderError(result.error),
        manualEntry: undefined,
      };
      return;
    }
    providerModelsState[config.id] = {
      status: "error",
      message: describeProviderError(result.error),
      error: result.error,
    };
    return;
  }

  const entries = await resolveCapabilities(client, result.value);
  if (providerTokens[config.id] !== token) return; // superseded by a later reload for this provider
  providerModelsState[config.id] = { status: "loaded", entries };
}

/** Re-run one provider's model list — the picker's per-group "Retry" affordance after `modelsByProvider[id].status === "error"` (or its empty/zero-models state). Unlike the initial `ensureModelsLoaded` pass, this always reloads, even for a provider already showing something. */
export function reloadModels(providerId: string): void {
  const config = findProvider(providerId);
  if (config) void loadModelsForProvider(config);
}

/**
 * Look up (or synthesize, for a `"not-supported"` provider) a manually
 * entered model id and check its capability, so the picker can show it in
 * the same three-bucket grouping as every other row rather than blindly
 * trusting a typed string. Only meaningful while that provider's
 * `modelsByProvider[providerId].status === "not-supported"`.
 */
export async function enterManualModel(providerId: string, modelId: string): Promise<void> {
  const trimmed = modelId.trim();
  if (!trimmed) return;
  const state = providerModelsState[providerId];
  if (state?.status !== "not-supported") return;

  const config = findProvider(providerId);
  const client = config ? buildClient(config) : undefined;
  if (!client) return;

  const token = providerTokens[providerId] ?? 0; // manual entry doesn't invalidate an in-flight list load, but a real reload should invalidate a stale manual-entry write
  const model: ProviderModel = { id: trimmed, name: trimmed };
  const capability = await resolveCapability(client, model);
  if (providerTokens[providerId] !== token) return;

  const current = providerModelsState[providerId];
  if (current?.status !== "not-supported") return;
  providerModelsState[providerId] = { ...current, manualEntry: { model, capability } };
}

// ---------------------------------------------------------------------------
// Committing a model selection
// ---------------------------------------------------------------------------

/**
 * Commit `{providerId, model}` as the active selection: persists it into
 * the current tab's session (decisions/07, /10) and, only if no global
 * default exists yet, seeds the default too (so a brand-new tab has
 * something sensible to inherit — decisions/10's "exactly one active
 * provider+model pair is tracked as the default", which this never
 * overwrites once set, keeping tabs free to diverge from it). No-ops if the
 * model isn't selectable ({@link isSelectable} — decisions/06/11's shared
 * rule) in that provider's current `modelsByProvider` entry — the caller
 * (the picker component) should never wire a disabled row's click handler
 * to this, but this is the second guard against sending a no-tools/unknown
 * model to `chat()` unattached-to-tools by accident.
 *
 * Also the dangling-provider replacement path (decisions/10, card 27's
 * checklist): when `resolution.status === "dangling"`, the picker drives
 * the user through the same flat list and this same function commits the
 * replacement — so it inherits the single-owner write below with no
 * separate code path to re-audit.
 *
 * Persists via `ChatService.setSelection` (src/domain/chat), which mutates the
 * SAME live session object the turn appends messages to — never a stale copy
 * this module loaded earlier — so this can never clobber history (card 27).
 */
export async function selectModel(providerId: string, model: string): Promise<void> {
  if (tabId === undefined) return;
  const config = findProvider(providerId);
  if (!config) return;

  const entry = entriesFor(providerId).find((e) => e.model.id === model);
  if (!entry || !isSelectable(entry.capability)) return;

  const next: ProviderSelection = { providerId, model };

  // Card 35: a click here IS the deliberate choice — explicit: true.
  await chat().setSelection(tabId, next, true);
  selectionExplicit = true;

  // Seeding the global default is a convenience, not part of committing the
  // selection above — so a read or write failure here leaves the chat's own
  // (already persisted) choice intact and simply doesn't seed.
  const registry = sidePanelServices().providers;
  const [currentDefault, defaultErr] = await registry.getDefaultSelection();
  if (!defaultErr && !currentDefault) await registry.setDefaultSelection(next);

  resolution = { status: "ok", config, model };
}

/*
 * REMOVED: `confirmSelection`, card 35's one-click "Use <provider> · <model>"
 * nod for the `needs-confirmation` state.
 *
 * Since decisions/18 the model chip lives inside the composer, right under
 * that state's own explanatory line, so the composer was offering the same
 * confirmation twice in one box. The chip won: it names the same
 * provider/model and opens the picker, and picking the already-active row
 * there goes through `selectModel` — which marks the selection explicit
 * exactly as this did.
 *
 * Routing confirmation through `selectModel` also closes a hole this had:
 * it only checked `resolution.status === "ok"`, never capability, so it
 * could confirm a model that isn't tool-capable. `handlePickModel` in
 * ProviderPicker.svelte refuses those rows (decisions/06, /11).
 */

/** Card 35/36's shared picker popover — open it (e.g. from Composer's blocked-composer empty state), so ProviderPicker.svelte's already-mounted instance in the composer's action row shows up in exactly one click. */
export function openPicker(): void {
  pickerOpen = true;
}

/** Close the shared picker popover — ProviderPicker.svelte's click-outside/Escape/pick-a-model handlers call this. */
export function closePicker(): void {
  pickerOpen = false;
}

// ---------------------------------------------------------------------------
// Dangling-provider replacement (decisions/10)
// ---------------------------------------------------------------------------

/** Re-run the provider list + every provider's model list, and the tab resolution, from scratch — for a "Refresh" affordance after fixing something on the options page (adding a provider, re-granting a permission) without closing and reopening the panel. Unlike `ensureModelsLoaded`'s incremental caching, this force-reloads every currently-registered provider. */
export async function refresh(): Promise<void> {
  if (tabId === undefined) return;
  await loadProviders();
  await Promise.all(providers.map((p) => loadModelsForProvider(p)));
  const currentTabId = tabId;
  const currentOrigin = origin;
  // TODO: clean-code - 0.2 - KISS: mutating tabId to undefined solely to flip syncToTab's changedTab branch is a side-channel signal rather than an explicit parameter; syncToTab(tabId, origin, { force: true }) would say the same thing without exploiting the "assign to invalidate identity" trick.
  tabId = undefined; // force syncToTab's changedTab branch
  await syncToTab(currentTabId, currentOrigin);
}

/** Open the extension's options page — the "no providers registered" and "provider deleted" empty states both link here (decisions/10: provider CRUD lives only in the options page). */
export function openOptionsPage(): void {
  sidePanelServices().shell.openOptionsPage();
}

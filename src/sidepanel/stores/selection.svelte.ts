// Provider + model selection for the side panel's picker (card 23,
// decisions/10-provider-registry-and-credential-storage.md,
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
// State model, deliberately split into two things that can disagree:
//   - `resolution`: the PERSISTED selection for the active tab's session
//     (decisions/07, decisions/10) — "none" (nothing chosen yet), "dangling"
//     (chosen, then the provider was deleted), or "ok" (a live provider +
//     model). This is what the agent loop should read.
//   - `browsingProviderId` / `models`: the picker UI's own in-progress
//     browsing state (level 1 = provider, level 2 = model) — lets the user
//     look at a different provider's models before committing. Only
//     `selectModel` commits a browse into `resolution`.
//
// SINGLE OWNER (card 27, boards/project-backlog/27-selection-store-stale-session-write.md):
// this module used to hold its own private `ChatSession` copy just to
// read/write the `selection` field, loaded independently of
// `src/sidepanel/stores/panel.svelte.ts`'s live copy (the one the agent
// loop appends messages to). That second copy going stale — it never saw
// messages appended through panel's copy — is exactly what let
// `selectModel()` silently overwrite history with an emptier snapshot the
// moment the user changed provider/model mid-conversation.
//
// The fix: this module no longer loads or holds a `ChatSession` at all. It
// reads/writes only the `selection` field, and does so through
// `panel.svelte.ts`'s `getSessionSelection`/`setSessionSelection`, which
// operate on the SAME live object every other session mutator writes to.
// `resolveSelection` (from the registry, the same resolver
// `src/lib/session.ts`'s `resolveSessionSelection` wraps) is called
// directly against that plain `{providerId, model} | undefined` value — no
// `ChatSession` needed for that either.

import {
  createProviderClient,
  getDefaultSelection,
  listProviders,
  resolveSelection,
  setDefaultSelection,
  type ProviderConfig,
  type ProviderSelection,
} from "../../lib/providers/registry";
import {
  describeProviderError,
  type ChatProvider,
  type ModelCapabilities,
  type ProviderError,
  type ProviderModel,
} from "../../lib/provider";
import { flushSession, type SelectionResolution } from "../../lib/session";
import { getSessionSelection, setSessionSelection } from "./panel.svelte";

export type { SelectionResolution } from "../../lib/session";

/** One row in the level-2 model list, with its capability lookup resolved (or still in flight). */
export interface ModelListEntry {
  model: ProviderModel;
  /** `undefined` while the per-model capability check is still in flight. */
  capability: ModelCapabilities | undefined;
}

/** State of the level-2 model list for whichever provider is currently being browsed. */
export type ModelsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; entries: ModelListEntry[] }
  /**
   * The provider's `listModels()` failed outright (unreachable, auth, etc.)
   * — distinct from "loaded with zero tool-capable entries". `error` is the
   * raw `ProviderError` alongside `message` (its prose form) so the picker
   * can branch on `.kind` for a kind-specific fix — a copyable CORS command,
   * an "open options" shortcut for an auth failure — the same vocabulary
   * card 22's options-page UI already keys off (src/options/lib/testResultDisplay.ts),
   * never a second one invented here (card 14).
   */
  | { status: "error"; message: string; error: ProviderError }
  /**
   * The provider has no model-listing API (`ProviderError.kind === "not-supported"`,
   * e.g. some OpenAI-compatible hosts) — the picker falls back to letting the
   * user type a model id, per `src/lib/provider.ts`'s `listModels` doc comment.
   */
  | { status: "not-supported"; message: string; manualEntry: ModelListEntry | undefined };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tabId = $state<number | undefined>(undefined);
let origin = $state<string>("");

let providers = $state<ProviderConfig[]>([]);
let providersStatus = $state<"loading" | "loaded" | "error">("loading");

let resolution = $state<SelectionResolution>({ status: "none" });

/** The provider currently shown at level 1 of the picker — not necessarily the persisted `resolution`'s provider until `selectModel` commits it. */
let browsingProviderId = $state<string | undefined>(undefined);
let modelsState = $state<ModelsState>({ status: "idle" });

/** Guards against a stale async `loadModels` response landing after the user has already switched providers again. */
let modelsRequestToken = 0;

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

function findProvider(id: string | undefined): ProviderConfig | undefined {
  return id === undefined ? undefined : providers.find((p) => p.id === id);
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
  get browsingProviderId(): string | undefined {
    return browsingProviderId;
  },
  get browsingProvider(): ProviderConfig | undefined {
    return findProvider(browsingProviderId);
  },
  get modelsState(): ModelsState {
    return modelsState;
  },
  /** Tool-capability of the currently *selected* (persisted, not just browsed) model, if resolved and its capability lookup has completed. The agent loop should only attach page tools when this is `"tool-capable"` (decisions/11). */
  get activeCapability(): ModelCapabilities | undefined {
    const r = resolution;
    if (r.status !== "ok") return undefined;
    const m = modelsState;
    if (m.status !== "loaded" && m.status !== "not-supported") return undefined;
    const entries = m.status === "loaded" ? m.entries : m.manualEntry ? [m.manualEntry] : [];
    return entries.find((e) => e.model.id === r.model)?.capability;
  },
};

// ---------------------------------------------------------------------------
// Loading providers + the tab's session
// ---------------------------------------------------------------------------

async function loadProviders(): Promise<void> {
  providersStatus = "loading";
  try {
    providers = await listProviders();
    providersStatus = "loaded";
  } catch {
    providers = [];
    providersStatus = "error";
  }
}

/**
 * Point the store at a tab: resolves its persisted selection (reading it
 * off `panel.svelte.ts`'s live session for `newTabId` — see this module's
 * header comment) and primes the picker's level-1 provider to whatever is
 * already resolved (falling back to the first registered provider so the
 * picker has something to show). Call whenever the panel's active tab
 * changes (including the initial mount) — safe to call repeatedly for the
 * same `tabId`.
 *
 * Relies on `panel.svelte.ts` having already loaded (or created) `newTabId`'s
 * session by the time this runs — true for this store's one caller
 * (`ProviderPicker.svelte`'s effect on `panel.pageInfo`), since
 * `activeTab.ts`'s `refreshActiveTab` always awaits `syncSessionToTab`
 * before setting `pageInfo`. If that ever isn't true yet (session not
 * loaded for this tab), `getSessionSelection` returns `undefined` and this
 * resolves to `"none"` rather than guessing — a transient display gap, not
 * a lost write, and it self-corrects on the next sync.
 */
export async function syncToTab(newTabId: number, newOrigin: string): Promise<void> {
  const changedTab = tabId !== newTabId || origin !== newOrigin;
  tabId = newTabId;
  origin = newOrigin;

  if (providersStatus === "loading" || changedTab) {
    await loadProviders();
  }

  const defaultSelection = await getDefaultSelection();

  // Seed a brand-new session with the global default the first time this
  // tab is seen — but write it through panel's live session (never a
  // private copy): setSessionSelection no-ops harmlessly if that session
  // isn't loaded yet, and is idempotent once it is (a later run sees the
  // selection already set and skips the write).
  let persisted = getSessionSelection(newTabId);
  if (persisted === undefined && defaultSelection) {
    const applied = await setSessionSelection(newTabId, defaultSelection);
    if (applied) persisted = defaultSelection;
  }

  resolution = await resolveSelection(persisted);

  const nextBrowsingId =
    resolution.status === "ok"
      ? resolution.config.id
      : resolution.status === "dangling"
        ? providers[0]?.id
        : (providers.find((p) => p.id === defaultSelection?.providerId)?.id ?? providers[0]?.id);

  if (nextBrowsingId !== browsingProviderId || changedTab) {
    browsingProviderId = nextBrowsingId;
    if (browsingProviderId) void loadModels(browsingProviderId);
    else modelsState = { status: "idle" };
  }
}

// ---------------------------------------------------------------------------
// Level 1: browsing a provider's models
// ---------------------------------------------------------------------------

function buildClient(config: ProviderConfig): ChatProvider | undefined {
  try {
    return createProviderClient(config);
  } catch {
    // No factory registered for this provider's type (registry.ts: a
    // programming-error path, e.g. a self-registering module — see
    // src/lib/providers/openai.ts — that was never imported for this
    // entry point). Surface as a plain error rather than throwing through
    // the picker.
    return undefined;
  }
}

async function loadModels(providerId: string): Promise<void> {
  const token = ++modelsRequestToken;
  modelsState = { status: "loading" };

  const config = findProvider(providerId);
  if (!config) {
    const message = "This provider is no longer registered.";
    modelsState = { status: "error", message, error: { kind: "invalid-response", message } };
    return;
  }

  const client = buildClient(config);
  if (!client) {
    // Programming-error path (registry.ts: no factory registered for this
    // provider type), not an actual `ProviderError` from a client — there
    // is no real "kind" to report, so this is the closest honest fit
    // rather than fabricating a network/auth failure that didn't happen.
    const message = `No client is registered for provider type "${config.type}".`;
    modelsState = { status: "error", message, error: { kind: "invalid-response", message } };
    return;
  }

  const result = await client.listModels();
  if (token !== modelsRequestToken) return; // superseded by a later browse

  if (!result.ok) {
    if (result.error.kind === "not-supported") {
      modelsState = {
        status: "not-supported",
        message: describeProviderError(result.error),
        manualEntry: undefined,
      };
      return;
    }
    modelsState = {
      status: "error",
      message: describeProviderError(result.error),
      error: result.error,
    };
    return;
  }

  const entries = await resolveCapabilities(client, result.value);
  if (token !== modelsRequestToken) return; // superseded by a later browse
  modelsState = { status: "loaded", entries };
}

/** Capability lookups run concurrently, one per model (decision 06's "issued concurrently and cached thereafter", carried into decision 11). A lookup failure resolves to `"unknown"` with the error as its reason — never dropped from the list. */
async function resolveCapabilities(
  client: ChatProvider,
  models: ProviderModel[],
): Promise<ModelListEntry[]> {
  const capabilities = await Promise.all(
    models.map(async (model) => {
      const result = await client.getCapabilities(model);
      return result.ok
        ? result.value
        : ({ status: "unknown", detail: [describeProviderError(result.error)] } as ModelCapabilities);
    }),
  );
  return models.map((model, i) => ({ model, capability: capabilities[i] }));
}

/** Switch the picker's level-1 provider without persisting anything yet — persisting happens once a model is actually chosen ({@link selectModel}). */
export function selectProvider(providerId: string): void {
  if (providerId === browsingProviderId) return;
  browsingProviderId = providerId;
  void loadModels(providerId);
}

/** Re-run the model list for whichever provider is currently browsed — the picker's "Retry" affordance after a `modelsState.status === "error"`. Unlike {@link selectProvider} this always reloads, even for the provider already showing. */
export function reloadModels(): void {
  if (browsingProviderId) void loadModels(browsingProviderId);
}

/**
 * Look up (or synthesize, for a `"not-supported"` provider) a manually
 * entered model id and check its capability, so the picker can show it in
 * the same three-state list rather than blindly trusting a typed string.
 * Only meaningful while `modelsState.status === "not-supported"`.
 */
export async function enterManualModel(modelId: string): Promise<void> {
  const trimmed = modelId.trim();
  if (!trimmed || modelsState.status !== "not-supported") return;
  const config = findProvider(browsingProviderId);
  const client = config ? buildClient(config) : undefined;
  if (!client) return;

  const token = modelsRequestToken; // manual entry doesn't invalidate an in-flight list load
  const model: ProviderModel = { id: trimmed, name: trimmed };
  const result = await client.getCapabilities(model);
  if (token !== modelsRequestToken || modelsState.status !== "not-supported") return;
  const capability: ModelCapabilities = result.ok
    ? result.value
    : { status: "unknown", detail: [describeProviderError(result.error)] };
  modelsState = { ...modelsState, manualEntry: { model, capability } };
}

// ---------------------------------------------------------------------------
// Level 2: committing a model selection
// ---------------------------------------------------------------------------

/**
 * Commit `{browsingProviderId, model}` as the active selection: persists it
 * into the current tab's session (decisions/07, /10) and, only if no global
 * default exists yet, seeds the default too (so a brand-new tab has
 * something sensible to inherit — decisions/10's "exactly one active
 * provider+model pair is tracked as the default", which this never
 * overwrites once set, keeping tabs free to diverge from it). No-ops if the
 * model isn't `"tool-capable"` in the current `modelsState` — the caller
 * (the picker component) should never wire a disabled row's click handler
 * to this, but this is the second guard against sending a no-tools/unknown
 * model to `chat()` unattached-to-tools by accident.
 *
 * Also the dangling-provider replacement path (decisions/10, card 27's
 * checklist): when `resolution.status === "dangling"`, the picker drives
 * the user through the same browse-then-pick flow and this same function
 * commits the replacement — so it inherits the single-owner write below
 * with no separate code path to re-audit.
 *
 * Persists via `setSessionSelection` (`panel.svelte.ts`), which mutates the
 * SAME live session object the agent loop appends messages to — never a
 * stale copy this module loaded earlier — so this can never clobber
 * history (card 27).
 */
export async function selectModel(model: string): Promise<void> {
  const providerId = browsingProviderId;
  if (!providerId || tabId === undefined) return;
  const config = findProvider(providerId);
  if (!config) return;

  const entry = currentEntries().find((e) => e.model.id === model);
  if (!entry || entry.capability?.status !== "tool-capable") return;

  const next: ProviderSelection = { providerId, model };

  await setSessionSelection(tabId, next);

  const currentDefault = await getDefaultSelection();
  if (!currentDefault) await setDefaultSelection(next);

  resolution = { status: "ok", config, model };
}

function currentEntries(): ModelListEntry[] {
  if (modelsState.status === "loaded") return modelsState.entries;
  if (modelsState.status === "not-supported" && modelsState.manualEntry) {
    return [modelsState.manualEntry];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Dangling-provider replacement (decisions/10)
// ---------------------------------------------------------------------------

/** Re-run the provider list + tab resolution from scratch — for a "Retry" affordance after fixing something on the options page (adding a provider, re-granting a permission) without closing and reopening the panel. */
export async function refresh(): Promise<void> {
  if (tabId === undefined) return;
  await loadProviders();
  const currentTabId = tabId;
  const currentOrigin = origin;
  tabId = undefined; // force syncToTab's changedTab branch
  await syncToTab(currentTabId, currentOrigin);
}

/** Flush any pending session write immediately — the picker component calls this from the panel's unload/visibility-change path if it owns one, mirroring `src/lib/session.ts`'s `flushSession` contract. Safe to call with nothing pending. */
export async function flush(): Promise<void> {
  if (tabId === undefined) return;
  await flushSession(tabId);
}

/** Open the extension's options page — the "no providers registered" and "provider deleted" empty states both link here (decisions/10: provider CRUD lives only in the options page). */
export function openOptionsPage(): void {
  chrome.runtime.openOptionsPage();
}

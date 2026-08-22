// Shared tool-capability resolution + presentation logic
// (decisions/11-provider-capability-detection.md). The side panel's picker
// (src/sidepanel/stores/selection.svelte.ts, ModelPicker.svelte) and the
// options page's provider registry (src/options/components/ProvidersSection.svelte,
// ProviderRow.svelte) both need to answer the exact same question — "is this
// model actually safe to send tools to, and if not, why not" — and must give
// the user the exact same answer and the exact same words for it. Card 41
// ("Set as default" bypassing the panel's capability check) exists precisely
// because that logic used to live only inside ModelPicker.svelte as
// private helpers; this module is the single copy both surfaces import
// instead of drifting the way card 31 is about elsewhere in this repo.
//
// Nothing here talks to chrome.storage or knows about Svelte state — it's
// pure functions over the `ChatProvider`/`ModelCapabilities` vocabulary in
// ./provider.ts, so either surface can call it synchronously or from an
// async load path however fits its own state shape.
//
// Card 73 moved this module into the `providers` bounded context and left
// its one presentational export behind: `capabilityBadge` (a glyph + a
// label) is wording, not policy, and now lives in
// src/sidepanel/presentation/capabilityBadge.ts. What stays here answers questions —
// "what is this model's capability", "is it selectable", "why not" — in the
// domain's own `ToolCapabilityStatus` vocabulary. `reasonForCapability` is
// the deliberate exception: its strings are the provider's own
// `capability.detail` text plus a fallback sentence, and decisions/11 makes
// that exact wording a cross-surface contract.

import {
  describeProviderError,
  type ChatProvider,
  type ModelCapabilities,
  type ProviderError,
  type ProviderModel,
} from "./provider";

/** One model paired with the capability lookup for it — what {@link resolveCapabilities} and {@link loadProviderModels} hand back. */
export interface ModelCapabilityEntry {
  model: ProviderModel;
  capability: ModelCapabilities;
}

/**
 * Resolve one model's capability through `client.getCapabilities`, folding a
 * failed lookup into `"unknown"` with the error as its reason rather than
 * dropping it or guessing either way (decisions/11: "never guesses"). This is
 * the same fallback ModelPicker.svelte's model list has always applied
 * per-row; callers that only need ONE model's answer (the options page's
 * "Set as default", rather than a whole browsed list) get the identical
 * treatment.
 */
export async function resolveCapability(
  client: ChatProvider,
  model: ProviderModel,
  opts?: { signal?: AbortSignal; forceRefresh?: boolean },
): Promise<ModelCapabilities> {
  const [capability, err] = await client.getCapabilities(model, opts);
  return err ? { status: "unknown", detail: [describeProviderError(err)] } : capability;
}

/**
 * Resolve every model's capability concurrently, one lookup per model
 * (decision 06's "issued concurrently and cached thereafter", carried into
 * decision 11). Moved here from the side panel's `selection.svelte.ts`
 * (card 52) so the options page's per-provider model load
 * (`ProvidersSection.svelte`) can share the exact same behavior instead of
 * hand-rolling a second copy — the same "single copy both surfaces import"
 * ethos this module's header comment already commits to.
 */
export async function resolveCapabilities(
  client: ChatProvider,
  models: ProviderModel[],
): Promise<ModelCapabilityEntry[]> {
  return Promise.all(
    models.map(async (model) => ({ model, capability: await resolveCapability(client, model) })),
  );
}

/**
 * How one provider's model load ended. The error is handed back RAW, never as
 * prose: each surface localizes it through its own `describeProviderError`
 * wrapper (src/ui/providerMessage.ts), and the side panel additionally
 * branches on `error.kind` to offer a kind-specific fix.
 *
 * `"not-supported"` is kept apart from `"error"` because it is not a failure
 * of this provider — it means the endpoint has no model-listing API at all
 * (see `ChatProvider.listModels`), which the side panel answers with a manual
 * model-id entry and the options page answers by pointing at that.
 */
export type ProviderModelsLoad =
  | { status: "loaded"; entries: ModelCapabilityEntry[] }
  | { status: "not-supported"; error: ProviderError }
  | { status: "error"; error: ProviderError };

/**
 * List one provider's models and resolve every model's capability — the whole
 * "listModels -> branch on the error kind -> resolveCapabilities" sequence,
 * once (card 113).
 *
 * Both surfaces ran this sequence by hand, at length, and each surface's copy
 * was marked 0.45 DRY against the other: the side panel's
 * src/sidepanel/stores/selection.svelte.ts `loadModelsForProvider` (which then
 * shows a grouped picker) and the options page's
 * src/options/components/ProvidersSection.svelte `loadDefaultModelOptions`
 * (which then filters to `isSelectable` for a "Set as default" dropdown).
 * What differs between them is only what they STORE — different state shapes,
 * different reactive containers — so that is what stayed with each caller,
 * exactly as decisions/23's accepted duplication was always scoped to.
 *
 * Supersession is the caller's, not this function's: a surface that reloads
 * one provider while an earlier load for that SAME provider is still in
 * flight passes `stillCurrent`, and gets `undefined` back — meaning "you were
 * superseded, write nothing". It is consulted at both await boundaries, so a
 * superseded list load never goes on to issue the capability lookups either,
 * which is exactly what the hand-written copies did with their token checks.
 */
export async function loadProviderModels(
  client: ChatProvider,
  opts?: { stillCurrent?: () => boolean },
): Promise<ProviderModelsLoad | undefined> {
  const current = opts?.stillCurrent ?? (() => true);

  const [models, listErr] = await client.listModels();
  if (!current()) return undefined;
  if (listErr) {
    return listErr.kind === "not-supported"
      ? { status: "not-supported", error: listErr }
      : { status: "error", error: listErr };
  }

  const entries = await resolveCapabilities(client, models);
  if (!current()) return undefined;
  return { status: "loaded", entries };
}

/**
 * Whether a model with this capability can actually be selected — the ONE
 * place "tool-capable, and nothing else" is decided (decisions/06,
 * decisions/11). Both `"no-tools"` and `"unknown"` are refused; only a
 * confirmed "yes" is selectable, and `undefined` (capability still loading,
 * or never checked) is treated as not-yet-selectable rather than assumed
 * safe.
 */
export function isSelectable(capability: ModelCapabilities | undefined): boolean {
  return capability?.status === "tool-capable";
}

/**
 * The inline reason to show next to a model explaining why it is or isn't
 * selectable — `capability.detail` joined into one line, when the provider
 * (or `resolveCapability`'s own describeProviderError fallback) supplied any.
 *
 * Card 102 (decisions/37-i18n-paraglide.md): this function used to ALSO
 * supply the two English fallback sentences for a `"no-tools"`/`"unknown"`
 * capability with no detail at all — moved UI-side, since decisions/34 keeps
 * copy out of the domain layer. `src/ui/capabilityMessage.ts`'s
 * `capabilityReason` is the one both surfaces (the side panel's
 * `ModelPicker.svelte`, the options page's `ProvidersSection.svelte`)
 * should call for the LOCALIZED version of the exact same fallback; this
 * domain function keeps returning `undefined` in that case rather than
 * inventing English.
 */
export function reasonForCapability(capability: ModelCapabilities | undefined): string | undefined {
  return capability?.detail?.join(" ");
}

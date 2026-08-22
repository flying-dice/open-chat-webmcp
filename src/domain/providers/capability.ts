// Shared tool-capability resolution + presentation logic
// (decisions/11-provider-capability-detection.md). The side panel's picker
// (src/sidepanel/stores/selection.svelte.ts, ProviderPicker.svelte) and the
// options page's provider registry (src/options/components/ProvidersSection.svelte,
// ProviderRow.svelte) both need to answer the exact same question — "is this
// model actually safe to send tools to, and if not, why not" — and must give
// the user the exact same answer and the exact same words for it. Card 41
// ("Set as default" bypassing the panel's capability check) exists precisely
// because that logic used to live only inside ProviderPicker.svelte as
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
  type ProviderModel,
} from "./provider";

/**
 * Resolve one model's capability through `client.getCapabilities`, folding a
 * failed lookup into `"unknown"` with the error as its reason rather than
 * dropping it or guessing either way (decisions/11: "never guesses"). This is
 * the same fallback ProviderPicker.svelte's model list has always applied
 * per-row; callers that only need ONE model's answer (the options page's
 * "Set as default", rather than a whole browsed list) get the identical
 * treatment.
 */
export async function resolveCapability(
  client: ChatProvider,
  model: ProviderModel,
  opts?: { signal?: AbortSignal; forceRefresh?: boolean },
): Promise<ModelCapabilities> {
  const result = await client.getCapabilities(model, opts);
  return result.ok
    ? result.value
    : { status: "unknown", detail: [describeProviderError(result.error)] };
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
): Promise<{ model: ProviderModel; capability: ModelCapabilities }[]> {
  const capabilities = await Promise.all(models.map((model) => resolveCapability(client, model)));
  return models.map((model, i) => ({ model, capability: capabilities[i] }));
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
 * selectable — the exact fallback wording every surface built on
 * {@link ModelCapabilities} should use, so a `"no-tools"`/`"unknown"` model
 * reads identically whether it showed up disabled in the side panel's picker
 * or blocked "Set as default" on the options page.
 */
export function reasonForCapability(capability: ModelCapabilities | undefined): string | undefined {
  if (!capability) return undefined;
  if (capability.status === "unknown") {
    return capability.detail?.join(" ") ?? "Tool support not verified for this model.";
  }
  if (capability.status === "no-tools") {
    return capability.detail?.join(" ") ?? "This model doesn't support tool calling.";
  }
  return capability.detail?.join(" ");
}

// User-facing prose for a `ModelCapabilities` reason (card 102,
// decisions/37-i18n-paraglide.md, decisions/34-errors-as-values.md).
//
// `reasonForCapability` (src/domain/providers/capability.ts) answers "what
// evidence is there", from the domain's own `ModelCapabilities.detail` —
// provider-supplied text (Ollama's raw `/api/show` capabilities array, or a
// describeProviderError fallback baked in by `resolveCapability`). It used
// to ALSO invent the two sentences for "no evidence at all" itself; that
// copy moved here, the same split src/ui/storageMessage.ts and
// src/ui/providerMessage.ts already establish for their own domain types.
//
// Both surfaces that show a capability's blocked/unverified reason — the
// side panel's ProviderPicker.svelte and the options page's
// ProvidersSection.svelte (via ProviderRow.svelte's
// `defaultModelBlockedReason` and the stale-default banner) — should call
// `capabilityReason` here instead of `reasonForCapability` directly, so a
// model with genuinely no detail reads the same localized sentence on both
// pages.

import type { ModelCapabilities } from "../domain/providers";
import { reasonForCapability } from "../domain/providers";
import { m } from "../paraglide/messages.js";

/**
 * The inline reason to show next to a model explaining why it is or isn't
 * selectable — `reasonForCapability`'s own detail text when there is any,
 * else the localized fallback wording every surface built on
 * {@link ModelCapabilities} should use, so a `"no-tools"`/`"unknown"` model
 * with no supplied detail reads identically whether it showed up disabled in
 * the side panel's picker or blocked "Set as default" on the options page.
 */
export function capabilityReason(capability: ModelCapabilities | undefined): string | undefined {
  const reason = reasonForCapability(capability);
  if (reason) return reason;
  if (capability?.status === "unknown") return m.capability_unverifiedFallback();
  if (capability?.status === "no-tools") return m.capability_noToolsFallback();
  return undefined;
}

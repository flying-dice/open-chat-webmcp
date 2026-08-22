// TODO: clean-code - 0.35 - NAMING: src/sidepanel/lib/ is a generic "lib" folder name — the exact grab-bag name decisions/33 retired at the top level (src/lib -> src/ui) because "lib" hides a layer. Contents are legitimate surface-local presentation helpers, but the name reads as a leftover pre-DDD grab-bag.
// The glyph + wording for a model's tool-capability status — the UI half of
// decisions/11-provider-capability-detection.md.
//
// This used to be `capabilityBadge` in src/lib/providers/capability.ts. Card
// 73 (decisions/29) moved it out: the domain answers "what IS this model's
// capability" in its own `ToolCapabilityStatus` vocabulary
// (src/domain/providers), and the UI decides how that reads. The domain
// module kept `resolveCapability`/`isSelectable`/`reasonForCapability` —
// policy — and shed the only export that was purely presentation.
//
// Still one shared copy, for the same reason the domain module is one shared
// copy: decisions/11 makes "the exact same answer and the exact same words"
// a cross-surface requirement, and card 41 exists because that logic was
// once private to ProviderPicker.svelte.

import type { ToolCapabilityStatus } from "../../domain/providers";

/** Compact badge (icon glyph + label) for a capability status — shared verbatim so no surface built on this drifts on wording. */
export function capabilityBadge(status: ToolCapabilityStatus): { icon: string; label: string } {
  switch (status) {
    case "no-tools":
      return { icon: "⊘", label: "No tools" };
    case "unknown":
      return { icon: "?", label: "Unverified" };
    case "tool-capable":
      return { icon: "✓", label: "Tool-capable" };
  }
}

// Resolves a provider's icon KEY (chosen by the preset catalogue in
// src/domain/providers) to a glyph this UI can actually draw
// (src/lib/icons.ts).
//
// Card 73 (decisions/29) cut the presets→icons edge: the catalogue used to
// type its `icon` field as `IconName`, so the DOMAIN depended on which
// glyphs the panel happens to ship. Now the catalogue names a stable key and
// this UI-layer module owns the mapping — restyling, renaming or dropping a
// glyph is a UI-only change, and adding a preset needs no icon-set edit to
// typecheck.
//
// The trade the explicit table buys: an unrecognised key falls back to the
// generic glyph at runtime instead of failing `svelte-check`. That is the
// intended direction of failure — a new preset must never be able to break
// the build of a surface that doesn't even render its icon — and the table
// below is the one place to look when a preset renders as `smart_toy`
// unexpectedly.

import { iconKeyForProvider, type ProviderType } from "../domain/providers";
import type { IconName } from "./icons";

/** Generic fallback for a key this UI has no glyph for — matches the catalogue's own `smart_toy` default. */
const FALLBACK_ICON: IconName = "smart_toy";

/** Every icon key `src/domain/providers`' preset catalogue can name, mapped to this panel's icon set. Keys are the catalogue's; values are `src/lib/icons.ts`'s. */
const PROVIDER_ICONS: Record<string, IconName> = {
  air: "air",
  alt_route: "alt_route",
  bolt: "bolt",
  close: "close",
  diamond: "diamond",
  explore: "explore",
  group: "group",
  hexagon: "hexagon",
  ollama: "ollama",
  smart_toy: "smart_toy",
  sparkle: "sparkle",
  terminal: "terminal",
  widgets: "widgets",
};

/**
 * The icon to show next to a provider's models (picker rows, transcript
 * header). Delegates the "which key" question to the domain
 * ({@link iconKeyForProvider}) and answers only "which glyph".
 */
export function iconForProvider(provider: { type: ProviderType; presetId?: string }): IconName {
  return PROVIDER_ICONS[iconKeyForProvider(provider)] ?? FALLBACK_ICON;
}

// The text direction every PORTALLED surface has to be told (card 105,
// decisions/37-i18n-paraglide.md; card 104's RTL sweep).
//
// `<html dir>` is set once before mount by src/infra/dom/document-locale.ts,
// and CSS `direction` inherits, so everything rendered INSIDE the app tree
// mirrors for `ar` on its own — that is what card 104's logical-utility sweep
// bought. Portalled content does not, and not because of the portal: bits-ui's
// floating layer (node_modules/bits-ui/dist/bits/utilities/floating-layer/
// components/floating-layer-content.svelte) declares `dir = "ltr"` as a
// DEFAULT and stamps it as an attribute on the wrapper it renders under
// `<body>`. `direction` then inherits from that stamped attribute rather than
// from the document, so the whole popover computes `ltr` under an `rtl` page.
//
// Card 104 found the same defaulting in `ScrollArea` and fixed its two call
// sites; it recorded the floating layer as "not used", which was true of the
// utility by name and false of it in fact — Select, DropdownMenu, Popover and
// Tooltip content all build on it. It could only be SEEN once a real `ar`
// locale existed: card 105 opened the options page's language picker in
// Arabic and found the list left-aligned with its check mark on the wrong
// side, then confirmed the same `direction: ltr` on the side panel's overflow
// menu and model picker with a DOM probe.
//
// So: every `*.Content` from that family, and every `ScrollArea`, takes
// `dir={uiTextDirection()}`. Nothing else needs it. The fix lives at our own
// call sites rather than in the vendored kit, which the shadcn CLI can
// regenerate at any time.
//
// One asymmetry to know about, found by re-probing after the first fix:
// Select, Popover and Tooltip take `dir` on their CONTENT, but the menu family
// (`DropdownMenu`) declares it on the ROOT (bits/menu/types.d.ts) and passes
// it down itself — `dir` on `DropdownMenu.Content` is accepted by the types
// and silently does nothing. `OverflowMenu.svelte` therefore sets it on
// `<DropdownMenu.Root>`.
import { getTextDirection } from "../paraglide/runtime.js";

/**
 * The active locale's direction. `getTextDirection()` resolves it from
 * `Intl.Locale`'s text info, with Paraglide's own hardcoded RTL set as the
 * fallback — the same source `applyDocumentLocale()` uses for `<html dir>`,
 * so a popover can never disagree with the page it opened over.
 */
export function uiTextDirection(): "ltr" | "rtl" {
  return getTextDirection();
}

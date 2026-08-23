// `dom` adapter (card 78) — the browser-document capabilities a composition
// root wires up before it mounts anything, as distinct from the `chrome.*`
// extension APIs that fill the other src/infra folders.
//
// Three things: mirroring `prefers-color-scheme` onto `<html class="dark">`
// (./dark-mode.ts), stamping the active locale onto `<html lang>`/`<html
// dir>` (./document-locale.ts, card 100), and reading text back OUT of a
// document (./page-extraction.ts, card 118). The first two are attributes on
// the document element that must be right before the first paint, both wired
// by a composition root — the same shape, for the same reason.
//
// ./page-extraction.ts is the other direction and belongs to a different
// root: src/content/relay.ts, the only code in this extension that touches a
// visited page's DOM (decisions/40). It is here rather than in src/content
// because it is technology adaptation — "how do you get text out of a
// `Document`" — with no relay-specific knowledge in it at all, which is what
// lets it be exercised against jsdom fixtures instead of a real browser.
//
// dark-mode.ts was `src/lib/dark-mode.ts`, and it left with the rest
// of the pre-DDD grab bag — not because it violated the layering (the UI may
// touch the DOM; that is what UI is), but because its two callers are the two
// composition roots and nothing else. It is a surface's runtime concern
// wired at boot, which is a composition-root duty
// (.claude/skills/ddd-hexagonal/SKILL.md), and `only-roots-construct-infra`
// now enforces that only a root may reach for it.

export { startDarkModeSync } from "./dark-mode";
export { applyDocumentLocale } from "./document-locale";
export {
  extractPageText,
  extractSelection,
  MIN_SELECTION_CHARS,
  PAGE_EXTRACT_CAP_BYTES,
  selectionIdentity,
  type ExtractedText,
} from "./page-extraction";

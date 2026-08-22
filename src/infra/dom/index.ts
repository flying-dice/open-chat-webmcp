// `dom` adapter (card 78) — the browser-document capabilities a composition
// root wires up before it mounts anything, as distinct from the `chrome.*`
// extension APIs that fill the other src/infra folders.
//
// Two things: mirroring `prefers-color-scheme` onto `<html class="dark">`
// (./dark-mode.ts), and stamping the active locale onto `<html lang>`/`<html
// dir>` (./document-locale.ts, card 100). Both are attributes on the document
// element that must be right before the first paint, and both are wired by a
// composition root — the same shape, for the same reason.
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

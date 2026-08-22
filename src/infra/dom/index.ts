// `dom` adapter (card 78) — the browser-document capabilities a composition
// root wires up before it mounts anything, as distinct from the `chrome.*`
// extension APIs that fill the other src/infra folders.
//
// One thing today: mirroring `prefers-color-scheme` onto `<html class="dark">`
// (./dark-mode.ts). It was `src/lib/dark-mode.ts`, and it left with the rest
// of the pre-DDD grab bag — not because it violated the layering (the UI may
// touch the DOM; that is what UI is), but because its two callers are the two
// composition roots and nothing else. It is a surface's runtime concern
// wired at boot, which is a composition-root duty
// (.claude/skills/ddd-hexagonal/SKILL.md), and `only-roots-construct-infra`
// now enforces that only a root may reach for it.

export { startDarkModeSync } from "./dark-mode";

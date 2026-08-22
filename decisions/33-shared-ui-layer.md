---
status: Accepted
date: 2026-08-22
---
# Decision 33 — `src/lib` becomes `src/ui`, a named shared-UI layer

## Context

Decision 29 set out to empty `src/lib`, the pre-DDD grab bag: of its 18
modules only about seven were infrastructure-free, and the rest held domain
rules, four `chrome.storage` repositories, three wire clients and the shared
UI kit all at once. Cards 73-78 took every one of those out — the tool
vocabulary and the provider contract to `src/domain`, the repositories to
`src/infra/chrome-storage`, the wire clients to `src/infra/{ollama,openai}`,
the MCP client and its OAuth flow to `src/infra/mcp`, and finally (card 78)
`permissions.ts` to `src/infra/chrome-runtime` and `dark-mode.ts` to
`src/infra/dom`.

What remained was genuinely UI and genuinely shared by both Svelte surfaces:
the vendored shadcn-svelte kit under `components/ui/` plus `utils.ts` (which
the kit imports as `$lib/utils`), `markdown.ts` and its `Markdown.svelte`,
`icons.ts`, `providerIcon.ts` and the ambient `webmcp.d.ts`. None of it
violates the layering — the UI layer may touch the DOM, which is what
`markdown.ts`'s DOMPurify call is — but the folder still could not be left
alone, because `.dependency-cruiser.cjs` had carried a finished-but-parked
`no-src-lib` rule since card 73 and card 78 was the last card of the DDD phase.

Three options were on the table, and card 76's note in that config had already
rejected one of them in writing:

1. **Enable `no-src-lib` with a carve-out** for the remaining files. Rejected
   there and here: it would encode "src/lib is fine actually", the opposite of
   what decision 29 concluded, and a rule with a file list is a rule that grows
   a file list.
2. **Leave the rule parked forever**, or rewrite it into something weaker like
   "src/lib may only import src/domain". That constrains what the grab bag
   imports but does nothing about what accumulates IN it, which is the failure
   mode decision 29 actually diagnosed.
3. **Rename the folder to the layer it holds.**

`no-cross-surface-imports` rules out the obvious alternative of pushing these
modules into one surface, and duplicating a markdown renderer and an icon set
into both bundles would be worse than either naming problem.

## Decision

`src/lib` becomes `src/ui`: a fourth, explicitly named layer holding
presentation both Svelte surfaces render through, plus the vendored kit. The
`$lib` alias keeps its spelling (`tsconfig.json`, `tsconfig.app.json`,
`vite.config.ts` all point it at `src/ui`) because that name is the
shadcn-svelte CLI's convention and is written into every file of the vendored
kit; the FOLDER is what names the layer.

Two lint rules land with it, both enforced from card 78:

- `no-src-lib` — nothing may import `src/lib`. It is a ratchet, not a
  description: the grab bag is gone and nothing recreates it under a name that
  means no layer.
- `shared-ui-is-ui-only` — `src/ui` may import `src/domain` and itself, and
  nothing else. Without this, "shared UI" is a grab bag with a nicer name. The
  domain edge is deliberate and already established: `providerIcon.ts` maps the
  preset catalogue's icon KEY (`src/domain/providers`) onto a glyph, which is
  the direction card 73 created when it moved that mapping out of the domain.

`infra-does-not-import-ui` is widened to cover `src/ui`, which subsumes the old
`infra-does-not-import-src-lib`.

The layer table in `.claude/skills/ddd-hexagonal/SKILL.md` gains the row, and
the vendored-kit exemption it already granted now reads `src/ui/components/ui/`.

## Consequences

- The full Decision 29 direction is lint-enforced with no parked rules left:
  `composition root → infra → domain`, UI to ports only, shared UI to domain
  types only, and no unnamed layer anywhere.
- `src/ui/components/ui/` is a slightly awkward path — "ui" twice — and the
  `$lib` alias no longer matches its folder name. Both are cosmetic and
  confined to the vendored subtree and three config lines; the alternative was
  rewriting ~100 generated files' imports so a future `shadcn add` would have
  to be reconfigured to match.
- A fourth layer is a real addition to the model, and the honest reading is
  that decision 29's three-layer table was incomplete rather than wrong: it
  described where OUR code goes and quietly exempted the kit. Shared
  presentation between two Svelte bundles is a real category, and it now has a
  name and a rule instead of an exemption.
- `dark-mode.ts` moved to `src/infra/dom` rather than into `src/ui`. It is
  DOM-touching bootstrap whose only two callers are the two composition roots —
  a surface's runtime concern wired at boot, which the skill lists as a
  composition-root duty — so `only-roots-construct-infra` now enforces that
  only a root reaches for it. `src/infra/dom` is the first infra folder named
  for a browser API rather than a `chrome.*` one, and is expected to stay
  small.

/**
 * Boundary guard — the lint half of `npm run guard:boundaries`
 * (decisions/29-ddd-hexagonal-typescript-layout.md,
 * decisions/31-clean-code-guard.md, card 73).
 *
 * The folder graph IS the architecture (.claude/skills/ddd-hexagonal/SKILL.md).
 * TypeScript cannot enforce the dependency direction — there are no crates
 * here — so this file does, and it runs in CI-shaped form as
 * `npm run guard:boundaries` and from the `pre-commit` skill.
 *
 * ── What this file can and cannot see ────────────────────────────────────
 *
 * dependency-cruiser parses `.svelte` as well as `.ts`/`.js`, so every rule
 * below applies to components and stores too (verified: it resolves
 * ProviderPicker.svelte's imports down to src/domain/providers/index.ts).
 *
 * What it cannot see is the platform GLOBALS — `chrome.*`, `fetch`,
 * `document`, `window` — because those are not imports at all and so fall
 * outside its model entirely. Yet "no chrome.* in the domain" is the single
 * most load-bearing rule in decisions/29. `scripts/guard-boundaries.mjs`
 * covers exactly that gap by scanning src/domain's source text, and
 * `npm run guard:boundaries` runs both. Neither alone is the guard.
 *
 * ── Enforced today vs. deferred ──────────────────────────────────────────
 *
 * Card 73 stood up `src/domain` and `src/infra` and moved only the modules
 * that were ALREADY infrastructure-free. `src/lib` still holds nine
 * infra-heavy modules (session.ts, both registries, ollama.ts, mcp/client.ts,
 * mcp/oauth.ts, settings.ts, permissions.ts, protocol.ts) that cards 74-79
 * move into `src/infra/*`. So the full Decision 29 direction rule —
 * "composition root → infra → domain, and nothing else" — is not satisfiable
 * by today's tree and would fail on the first run, which would make the guard
 * something people skip rather than something that holds.
 *
 * The rules below are therefore split in two:
 *
 *   ENFORCED  — true of the tree RIGHT NOW, and a regression in any of them
 *               is a real architectural regression. These have teeth today.
 *   DEFERRED  — the Decision 29 end state. Written out in full, commented,
 *               each with the card that turns it on. They are not aspiration
 *               notes to be rewritten later; they are the finished rule,
 *               parked.
 *
 * Turning a deferred rule on is meant to be a one-line uncomment in the card
 * that makes it true — if it needs rewriting instead, say so in that card.
 */

/** Every runtime surface that owns a composition root (`main.ts` / `sw.ts`). */
const SURFACES = "sidepanel|options|background|content";

module.exports = {
  forbidden: [
    // =====================================================================
    // ENFORCED — true of the tree today
    // =====================================================================

    {
      name: "domain-is-pure",
      severity: "error",
      comment:
        "A module in src/domain may not import anything outside src/domain. " +
        "The domain owns the model, the ports and the error vocabulary; " +
        "adapters (src/infra/*), UI (src/sidepanel, src/options), entry " +
        "points and the leftover src/lib all depend on IT, never the other " +
        "way round. If domain code needs something from the world, declare a " +
        "port here and let a composition root inject the adapter. " +
        "(.claude/skills/ddd-hexagonal/SKILL.md, decisions/29)",
      from: { path: "^src/domain/" },
      to: { path: "^src/(?!domain/)" },
    },
    {
      name: "domain-has-no-dependencies",
      severity: "error",
      comment:
        "src/domain must run in a bare Node test with zero mocks of platform " +
        "APIs (decisions/30's test pyramid depends on this), so it takes no " +
        "npm dependency at all — no Svelte, no marked/DOMPurify, no MCP SDK. " +
        "A domain rule that seems to need a library is either presentation " +
        "(move it to the UI layer, as capabilityBadge/originLabel were in " +
        "card 73) or infrastructure (put it behind a port).",
      from: { path: "^src/domain/" },
      to: { dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled"] },
    },
    {
      name: "domain-contexts-meet-at-barrels",
      severity: "error",
      comment:
        "Bounded contexts plug together through their index barrel, never by " +
        "reaching into each other's files — that barrel is the only thing a " +
        "context promises to keep stable. src/domain/providers/provider.ts " +
        "importing `../tools` is fine; importing `../tools/merge` is not.",
      from: { path: "^src/domain/([^/]+)/" },
      to: {
        path: "^src/domain/",
        pathNot: ["^src/domain/$1/", "^src/domain/[^/]+/index\\.[cm]?[jt]s$"],
      },
    },
    {
      name: "infra-does-not-import-ui",
      severity: "error",
      comment:
        "An adapter is driven BY a surface, never the reverse. src/infra/* " +
        "may see src/domain (the port it implements) and nothing of " +
        `src/{${SURFACES}} — a composition root wires the two together.`,
      from: { path: "^src/infra/" },
      to: { path: `^src/(${SURFACES})/` },
    },
    {
      name: "adapters-do-not-import-adapters",
      severity: "error",
      comment:
        "Two adapters that need each other must meet at a domain port " +
        "instead (ddd-hexagonal SKILL.md's smells table). This is the rule " +
        "that stops the src/lib/mcp/oauth.ts → src/lib/mcp/registry.ts " +
        "inversion (the transport stack writing the config store from inside " +
        "itself, decisions/29) from being rebuilt in src/infra once card 77 " +
        "moves those two modules apart.",
      from: { path: "^src/infra/([^/]+)/" },
      to: { path: "^src/infra/", pathNot: "^src/infra/$1/" },
    },
    {
      name: "no-cross-surface-imports",
      severity: "error",
      comment:
        "One runtime surface may never import another's modules. Shared code " +
        "belongs in src/domain (a rule) or src/infra (an adapter), or it " +
        "stays duplicated until it earns a home. The side panel and the " +
        "options page ship as separate bundles; a cross-import silently " +
        "doubles a module into both.",
      from: { path: `^src/(${SURFACES})/([^/]+)` },
      to: { path: `^src/(${SURFACES})/`, pathNot: "^src/$1/" },
    },
    {
      // WARN, not error, and deliberately so: the tree has exactly two
      // cycles today and neither is card 73's to fix.
      //
      //   1. src/lib/providers/ollama.ts ⇄ src/lib/providers/registry.ts —
      //      REAL, and precisely the "provider-type registration by
      //      side-effect import" inversion decisions/29 calls out. The
      //      adapter imports the registry to register ITSELF into the
      //      service locator the registry also owns. Card 79's explicit
      //      composition-root wiring deletes it; promote this rule to
      //      `error` in that card.
      //   2. ToolArgValue.svelte and SchemaProperty.svelte import
      //      themselves — they render recursive JSON/JSON-Schema trees, and
      //      a self-import is how a Svelte component recurses. Not a defect
      //      and never will be.
      //
      // Warnings are reported and do not fail the guard (same "visible,
      // accepted debt" treatment decisions/31 gives a ≤0.5 clean-code
      // marker), so this stays in the output instead of being deleted and
      // forgotten.
      name: "no-circular",
      severity: "warn",
      comment:
        "An import cycle means two modules are really one; in an MV3 bundle " +
        "it also risks a partially-initialised module at service-worker " +
        "startup. Split the shared part out, or push it down a layer.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolvable",
      severity: "error",
      comment:
        "An import that resolves to nothing. Almost always a path left stale " +
        "by a move — exactly what card 73 and cards 74-79 do constantly.",
      from: {},
      to: { couldNotResolve: true },
    },

    // =====================================================================
    // DEFERRED — the Decision 29 end state, parked until the card named in
    // each comment makes it true. Uncomment there; do not soften.
    // =====================================================================

    // Cards 74-79 (the last one to empty src/lib turns this on). src/lib is
    // the pre-DDD grab bag: it holds domain rules, four chrome.storage
    // repositories, three wire clients and the shared UI kit all at once.
    // When it is gone, nothing may recreate it.
    // {
    //   name: "no-src-lib",
    //   severity: "error",
    //   comment:
    //     "src/lib no longer exists: a module is a domain rule (src/domain), " +
    //     "an adapter (src/infra), or one surface's own code. The vendored " +
    //     "shadcn-svelte kit under src/lib/components/ui is excluded from " +
    //     "this cruise entirely and is not an exception to it.",
    //   from: { pathNot: "^src/lib/" },
    //   to: { path: "^src/lib/" },
    // },

    // Card 78/79 (once the options page's 7-of-11 direct chrome.* components
    // and the side panel's stores talk to injected ports instead). Today the
    // UI imports src/lib/providers/registry.ts and src/lib/session.ts
    // directly, which after those moves becomes a UI → infra edge.
    // {
    //   name: "ui-does-not-import-infra",
    //   severity: "error",
    //   comment:
    //     "A component or store sees domain types and injected ports only. " +
    //     "Concrete infrastructure is constructed in the surface's " +
    //     "composition root (src/sidepanel/main.ts, src/options/main.ts, " +
    //     "src/background/sw.ts) and passed in.",
    //   from: { path: `^src/(${SURFACES})/`, pathNot: `^src/(${SURFACES})/(main|sw)\\.ts$` },
    //   to: { path: "^src/infra/" },
    // },

    // Card 79 (with the provider-type registration rewrite). Today
    // src/sidepanel/main.ts and src/options/main.ts register the OpenAI
    // provider by SIDE-EFFECT import, which is why a new entry point that
    // forgets it hits a runtime "unregistered type" throw (decisions/29).
    // Explicit wiring is what makes this rule both possible and pointful.
    // {
    //   name: "only-roots-construct-infra",
    //   severity: "error",
    //   comment:
    //     "Only a composition root instantiates an adapter — one per runtime " +
    //     "surface, and nothing else. This is the rule that keeps 'swap the " +
    //     "store' a one-line change.",
    //   from: { pathNot: [`^src/(${SURFACES})/(main|sw)\\.ts$`, "^src/infra/"] },
    //   to: { path: "^src/infra/[^/]+/" },
    // },
  ],

  options: {
    /**
     * The vendored shadcn-svelte kit is generated source, not our
     * architecture (decisions/31, ddd-hexagonal SKILL.md). Excluded from
     * BOTH guards — this cruise and scripts/guard-clean-code.mjs.
     */
    exclude: {
      path: "^src/lib/components/ui/",
    },
    doNotFollow: {
      path: "node_modules",
    },
    /**
     * Resolves the `$lib` alias the shadcn-svelte kit imports through. The
     * app config is the one svelte-check uses, so the guard and the
     * typechecker agree on what a path means.
     */
    tsConfig: {
      fileName: "tsconfig.app.json",
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".js", ".mjs", ".cjs", ".json"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};

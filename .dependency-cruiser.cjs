/**
 * Boundary guard — the lint half of `npm run guard:boundaries`
 * (decisions/29-ddd-hexagonal-typescript-layout.md,
 * decisions/31-clean-code-guard.md, decisions/33-shared-ui-layer.md,
 * cards 73-78).
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
 * most load-bearing rule in decisions/29, and "chrome.* only in an adapter or
 * a composition root" is card 78's. `scripts/guard-boundaries.mjs` covers
 * exactly that gap by scanning source text, and `npm run guard:boundaries`
 * runs both. Neither alone is the guard.
 *
 * ── Nothing is deferred any more ─────────────────────────────────────────
 *
 * Cards 73-78 were the DDD move: card 73 stood up src/domain and src/infra;
 * cards 74-76 took the four `chrome.storage` repositories, the provider wire
 * clients, and the MCP client with its OAuth flow; card 77 took the chat
 * model, the agent turn and the panel god-store's non-view half; card 78 took
 * the UI's remaining `chrome.*` call sites, deleted the five interim wiring
 * modules those cards left behind, and renamed the emptied `src/lib` grab bag
 * to `src/ui` — the shared UI layer, which is all that was left in it
 * (decisions/33).
 *
 * Through that sequence this file carried three DEFERRED rules: the finished
 * rule, commented out, each naming the card that would make it true. All
 * three are now ENFORCED, and the full Decision 29 direction —
 * "composition root -> infra -> domain, and nothing else" — holds:
 *
 *   no-src-lib                 card 78 (via decisions/33's rename)
 *   ui-does-not-import-infra   card 78
 *   only-roots-construct-infra card 78
 *
 * There is no deferred section below any more, and a new rule should not
 * start one: a rule that is not true of the tree today is a card, not a
 * comment. When a change genuinely needs to break one of these, that is a
 * decision record (`decisions/`), not a drive-by.
 */

/** Every runtime surface that owns a composition root. */
const SURFACES = "sidepanel|options|background|content";

/**
 * The composition roots themselves — the ONLY modules allowed to name a
 * concrete adapter.
 *
 * `relay.ts` is in this list and belongs in it: decisions/29 counts three
 * roots because it counts the three modules it happened to name, but the
 * content script is a fourth runtime surface with its own entry point, its
 * own bundle and its own lifecycle, and it wires src/infra/chrome-runtime's
 * protocol and the timeout ladder exactly the way `sw.ts` does. Card 78 found
 * this the moment `only-roots-construct-infra` was switched on: the rule
 * failed on relay.ts's two imports, and the honest fix was to admit the
 * fourth root rather than to grant it an exception.
 */
const ROOTS = `^src/(${SURFACES})/(main|sw|relay)\\.ts$`;

module.exports = {
  forbidden: [
    // =====================================================================
    // The domain: pure, dependency-free, and reached through its barrels
    // =====================================================================

    {
      name: "domain-is-pure",
      severity: "error",
      comment:
        "A module in src/domain may not import anything outside src/domain. " +
        "The domain owns the model, the ports and the error vocabulary; " +
        "adapters (src/infra/*), the surfaces (src/sidepanel, src/options, " +
        "src/background, src/content) and the shared UI layer (src/ui) all " +
        "depend on IT, never the other way round. If domain code needs " +
        "something from the world, declare a port here and let a composition " +
        "root inject the adapter. " +
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
        "context promises to keep stable. src/domain/tools/sign-in.ts " +
        "importing `../permissions` is fine; importing " +
        "`../permissions/host-permissions` is not.",
      from: { path: "^src/domain/([^/]+)/" },
      to: {
        path: "^src/domain/",
        pathNot: [
          "^src/domain/$1/",
          "^src/domain/[^/]+/index\\.[cm]?[jt]s$",
          // Card 92 / decisions/34: `src/domain/result.ts` is a shared kernel
          // that IS one file — the decision names that path, and a
          // `result/index.ts` + `result/result.ts` pair (the shape
          // `src/domain/storage` has) would be a barrel over a single 90-line
          // module for no gain. Named literally rather than as
          // `^src/domain/[^/]+\.ts$` so the exception cannot widen into "any
          // loose file directly under src/domain": a second shared kernel is
          // a decision record, exactly as src/domain/storage/README.md says.
          "^src/domain/result\\.[cm]?[jt]s$",
        ],
      },
    },
    {
      // Card 77. The OUTWARD-FACING half of `domain-contexts-meet-at-barrels`
      // above, which only ever constrained one context importing another.
      //
      // Nothing outside src/domain deep-imports a context file today —
      // verified before enabling this, and verified to FAIL on a planted
      // `src/sidepanel/stores/panel.svelte.ts → src/domain/chat/turn.ts`
      // import. What made the rule worth having when it landed is that card
      // 77 took src/domain/chat from two files to nine: `turn.ts`,
      // `service.ts`, `message.ts`, `ports.ts` and the rest are internal
      // structure, and a UI file reaching past `index.ts` for one of them
      // would re-establish exactly the coupling that card spent its length
      // removing.
      name: "contexts-are-imported-through-their-barrel",
      severity: "error",
      comment:
        "A bounded context's index barrel is the only thing it promises to " +
        "keep stable. Import `src/domain/chat`, never `src/domain/chat/turn`. " +
        "If the barrel does not export what you need, that is a question about " +
        "the context's public surface, not a reason to reach around it.",
      from: { path: "^src/(?!domain/)" },
      to: {
        path: "^src/domain/[^/]+/",
        pathNot: "^src/domain/[^/]+/index\\.[cm]?[jt]s$",
      },
    },

    // =====================================================================
    // The adapters: driven by a root, never by each other, never by the UI
    // =====================================================================

    {
      name: "infra-does-not-import-ui",
      severity: "error",
      comment:
        "An adapter is driven BY a surface, never the reverse. src/infra/* " +
        "may see src/domain (the port it implements) and nothing of " +
        `src/{${SURFACES}} or src/ui — a composition root wires the two ` +
        "together. Card 78 widened this to src/ui, which subsumes the old " +
        "`infra-does-not-import-src-lib`: the folder that rule named is gone " +
        "(decisions/33), and what replaced it is the shared UI layer, which " +
        "an adapter has even less business importing.",
      from: { path: "^src/infra/" },
      to: { path: `^src/(${SURFACES}|ui)/` },
    },
    {
      name: "adapters-do-not-import-adapters",
      severity: "error",
      comment:
        "Two adapters that need each other must meet at a domain port " +
        "instead (ddd-hexagonal SKILL.md's smells table). This is the rule " +
        "that stops the src/lib/mcp/oauth.ts → registry inversion (the " +
        "transport stack writing the config store from inside itself, " +
        "decisions/29) from being rebuilt in src/infra. Card 76 is where it " +
        "earned its keep: moving oauth.ts into src/infra/mcp with its " +
        "`updateServer` call intact would have failed this rule on the first " +
        "run, which is exactly why that write now goes out through " +
        "`McpAuthTokenStore` (src/domain/tools), injected at the wiring site. " +
        "Card 78 hit it again from the other side: the MCP sign-in flow needs " +
        "host permissions, and src/infra/mcp may not reach into " +
        "src/infra/chrome-runtime for them — hence `HostPermissions` " +
        "(src/domain/permissions) and the orchestration living in " +
        "src/domain/tools/sign-in.ts.",
      from: { path: "^src/infra/([^/]+)/" },
      to: { path: "^src/infra/", pathNot: "^src/infra/$1/" },
    },
    {
      // Card 78 — the last of the three deferred rules, and the one that
      // makes the other two mean something. `ui-does-not-import-infra` alone
      // would still let src/ui, or a surface module that is not a component,
      // construct an adapter; this says only a root ever does.
      //
      // `to: "^src/infra/[^/]+/"` matches a module INSIDE a tech folder,
      // which is what an import of `../infra/chrome-storage` resolves to
      // (its index.ts). The effect is that no module outside src/infra and
      // outside the four roots may import an adapter at all — not for an
      // instance, not for a type, not for a constant. Card 77's note flagged
      // that last part as the half nobody had answered: activeTab.ts and
      // chatTurn.ts imported src/infra/chrome-runtime for a TYPE, and the
      // panel store read the timeout ladder out of src/infra/webmcp. The
      // answer turned out to be that each of those belonged somewhere else —
      // `SerializedTool` is a domain type the protocol adapter merely
      // carries, the ladder's rung is an argument the root injects, and the
      // tab listeners are an adapter of their own.
      name: "only-roots-construct-infra",
      severity: "error",
      comment:
        "Only a composition root reaches for an adapter — one per runtime " +
        "surface (src/sidepanel/main.ts, src/options/main.ts, " +
        "src/background/sw.ts, src/content/relay.ts), and nothing else. This " +
        "is the rule that keeps 'swap the store' a one-line change. If you " +
        "need a TYPE from an adapter, the type belongs in src/domain; if you " +
        "need an INSTANCE, the root builds it and hands it to you.",
      from: { pathNot: [ROOTS, "^src/infra/"] },
      to: { path: "^src/infra/[^/]+/" },
    },
    {
      // Card 78. Narrower than `only-roots-construct-infra` above and kept
      // alongside it deliberately: this one names the UI specifically, so a
      // component or store that regresses gets the message about ports and
      // injection rather than the message about composition roots. Both fire
      // on the same edge; the wording is the point.
      name: "ui-does-not-import-infra",
      severity: "error",
      comment:
        "A component or store sees domain types and injected ports only. " +
        "Concrete infrastructure is constructed in the surface's " +
        "composition root (src/sidepanel/main.ts, src/options/main.ts, " +
        "src/background/sw.ts, src/content/relay.ts) and handed down — for " +
        "the two Svelte surfaces, through their `app-services.ts` module, " +
        "which the root initialises before `mount(App)`.",
      from: { path: `^src/(${SURFACES}|ui)/`, pathNot: ROOTS },
      to: { path: "^src/infra/" },
    },

    // =====================================================================
    // The UI: one shared layer, and no cross-surface edges
    // =====================================================================

    {
      // Cards 74-78 emptied src/lib of everything that was not UI, and
      // decisions/33 renamed what was left. This rule is the ratchet on that:
      // the grab bag is gone, and nothing may recreate it under its old name.
      //
      // Note it is NOT vacuous by construction — a `mkdir src/lib` plus one
      // import fails it — and it is deliberately blind to whether the new
      // file would be "fine": the point of decisions/29 is that a module
      // wears its layer in its path, and `lib` names no layer.
      name: "no-src-lib",
      severity: "error",
      comment:
        "src/lib no longer exists (decisions/33): a module is a domain rule " +
        "(src/domain), an adapter (src/infra), shared UI (src/ui), or one " +
        "surface's own code. `lib` names no layer, which is how the pre-DDD " +
        "grab bag ended up holding domain rules, four chrome.storage " +
        "repositories, three wire clients and the shared UI kit at once.",
      from: { pathNot: "^src/lib/" },
      to: { path: "^src/lib/" },
    },
    {
      // Card 78 / decisions/33. src/ui is the FOURTH layer: the vendored
      // shadcn-svelte kit plus the handful of presentation modules both
      // Svelte surfaces render through (markdown.ts and its Markdown.svelte,
      // icons.ts, providerIcon.ts, utils.ts). Naming it was only half the
      // move; this is the other half, and without it "shared UI" would be a
      // grab bag with a nicer name.
      //
      // It may import src/domain — `providerIcon.ts` maps the preset
      // catalogue's icon KEY (src/domain/providers) onto a glyph, which is
      // exactly the direction card 73 established when it moved that mapping
      // out of the domain. It may not import an adapter (that is
      // `only-roots-construct-infra` too, and this says it in UI terms) and
      // it may not import a surface, which would invert the dependency that
      // makes it shareable at all.
      name: "shared-ui-is-ui-only",
      severity: "error",
      comment:
        "src/ui is the shared UI layer: presentation both Svelte surfaces " +
        "render through, plus the vendored shadcn-svelte kit. It may see " +
        "src/domain (types and rules), src/paraglide (its own copy — the " +
        "compiled message functions) and itself, and nothing else. A shared " +
        "UI module that needs an adapter wants a prop; one that needs a " +
        "surface's own module is not shared code and belongs in that surface.",
      from: { path: "^src/ui/" },
      // `|paraglide/` added by card 100: a shared component's own copy is
      // still copy, and `m.someKey()` is how copy is written from now on
      // (decisions/37). See `paraglide-is-not-for-the-domain` below for the
      // layer this tree sits in and the one place it may NOT be reached from.
      to: { path: "^src/(?!ui/|domain/|paraglide/)" },
    },

    // =====================================================================
    // Generated i18n (card 100, decisions/37-i18n-paraglide.md)
    // =====================================================================

    {
      // WHERE src/paraglide SITS IN THE LAYERING — the question card 100 had
      // to answer before a single `m.someKey()` could be written.
      //
      // It is not a fifth layer. It is GENERATED PRESENTATION: the compiler
      // turns `messages/{locale}.json` into one typed function per message,
      // and a message is copy — the same kind of thing a `<p>` holds. So it
      // belongs beside src/ui in the direction of the arrows (everything that
      // renders may reach it; it reaches nothing) rather than beside
      // src/domain or src/infra, and it is EXCLUDED from every guard the way
      // the vendored shadcn kit is (biome.jsonc's `linter.includes`, the
      // `VENDORED` list in scripts/lib/source-scan.mjs, tsconfig.app.json's
      // `exclude`), because no human writes it and every `npm ci` overwrites
      // it.
      //
      // The one edge that matters is this one. src/domain is the layer that
      // must run in a bare Node test with no platform mocks (decisions/29),
      // and `m.someKey()` is not platform-free: the generated runtime reads
      // `localStorage` and `navigator.languages` to resolve a locale. Beyond
      // the mechanics, decisions/34 and decisions/37 both say the same thing
      // about copy — the domain carries CODES, the UI maps codes to words.
      // A domain module that formats its own English sentence has taken a
      // presentation decision, and a domain module that formats a LOCALIZED
      // one has taken a presentation decision AND grown a global.
      //
      // `domain-is-pure` already forbids this edge (src/paraglide is outside
      // src/domain), and both rules fire on it. That is deliberate and is the
      // same pattern `ui-does-not-import-infra` uses next to
      // `only-roots-construct-infra`: a domain module reaching for `m` gets
      // told about the error-code convention, not just about purity.
      name: "paraglide-is-not-for-the-domain",
      severity: "error",
      comment:
        "The domain carries error CODES and identifiers, never user-visible " +
        "words — the UI maps a code to a message (decisions/34, decisions/37). " +
        "Components, stores and the shared UI layer call `m.someKey()` freely; " +
        "src/domain never does. Beyond the convention it would also break " +
        "domain purity: Paraglide's runtime resolves the active locale from " +
        "`localStorage` and `navigator.languages`.",
      from: { path: "^src/domain/" },
      to: { path: "^src/paraglide/" },
    },
    {
      // The other direction, and the reason the generated tree can be excluded
      // from the guards without a hole opening up: it is a LEAF. Paraglide's
      // output imports only its own sibling modules, so nothing our guards no
      // longer read can reach back into code they do. If this ever fails, the
      // codegen has grown a dependency on this repo's source and the exclusion
      // above stops being safe.
      name: "paraglide-is-a-leaf",
      severity: "error",
      comment:
        "src/paraglide is compiler output and imports nothing of ours. It is " +
        "excluded from biome, the clean-code/return-type/throw guards and the " +
        "type program on the grounds that it is generated and self-contained; " +
        "an edge out of it would make that exclusion a blind spot rather than " +
        "a convenience.",
      from: { path: "^src/paraglide/" },
      to: { path: "^src/(?!paraglide/)" },
    },
    {
      name: "no-cross-surface-imports",
      severity: "error",
      comment:
        "One runtime surface may never import another's modules. Shared code " +
        "belongs in src/domain (a rule), src/infra (an adapter) or src/ui " +
        "(presentation), or it stays duplicated until it earns a home. The " +
        "side panel and the options page ship as separate bundles; a " +
        "cross-import silently doubles a module into both.",
      from: { path: `^src/(${SURFACES})/([^/]+)` },
      to: { path: `^src/(${SURFACES})/`, pathNot: "^src/$1/" },
    },

    // =====================================================================
    // Hygiene
    // =====================================================================

    {
      // WARN, not error, and deliberately so.
      //
      // Card 73 recorded two cycles here. The first —
      // src/lib/providers/ollama.ts ⇄ src/lib/providers/registry.ts, the
      // "provider-type registration by side-effect import" inversion
      // decisions/29 calls out — is GONE as of card 74, incidentally rather
      // than by design: `ProviderConfig` moved to src/domain/providers, so
      // the Ollama adapter no longer imports the module that constructs it.
      // The service locator itself went with card 75's exhaustive factory
      // map.
      //
      // What remains is ToolArgValue.svelte importing ITSELF — it renders a
      // recursive JSON tree, and a self-import is how a Svelte component
      // recurses. Not a defect and never will be, so this rule cannot be
      // promoted to `error` even now that the real cycle is gone; it would
      // have to carry an exception for the recursive components first.
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
        "by a move — exactly what cards 73-78 did constantly.",
      from: {},
      to: { couldNotResolve: true },
    },
  ],

  options: {
    /**
     * The vendored shadcn-svelte kit is generated source, not our
     * architecture (decisions/31, decisions/33, ddd-hexagonal SKILL.md).
     * Excluded from BOTH guards — this cruise and
     * scripts/guard-clean-code.mjs. It moved with the rest of src/lib in card
     * 78 and is at src/ui/components/ui/ now; the path is the shadcn CLI's
     * (`components.json`'s `ui` alias), under the folder that names the
     * layer.
     *
     * `\.test\.ts$` (card 82, decisions/30) excludes the Vitest suite: a test
     * file's job is to import its test framework and exercise production
     * code from OUTSIDE the architecture, not to obey the same dependency
     * rules the code under test does — `domain-has-no-dependencies` would
     * otherwise flag every `src/domain/**\/*.test.ts`'s `import ... from
     * "vitest"` as the domain taking an npm dependency, which is not the
     * coupling that rule exists to catch.
     *
     * `\.stories\.svelte$` (card 123, decisions/42-storybook.md) is excluded
     * on identical grounds, and the rule it would otherwise trip is a real
     * one: a story imports its surface's `testing/fake-services` module, and
     * `only-roots-construct-infra` reserves that kind of wiring for the four
     * composition roots. A story IS a composition root — it is how the story
     * surface wires a component up — but it is one per component rather than
     * one per surface, so widening `ROOTS` to cover ~44 files would empty that
     * rule of meaning. Excluding the fixtures instead leaves it exact.
     */
    exclude: {
      path: "^src/ui/components/ui/|\\.test\\.ts$|\\.stories\\.svelte$",
    },
    doNotFollow: {
      path: "node_modules",
    },
    /**
     * Resolves the `$lib` alias the shadcn-svelte kit imports through. The
     * app config is the one svelte-check uses, so the guard and the
     * typechecker agree on what a path means. The alias still spells itself
     * `$lib` — that is the shadcn CLI's convention and every vendored file
     * writes it — but it points at src/ui (decisions/33).
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

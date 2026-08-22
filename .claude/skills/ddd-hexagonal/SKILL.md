---
name: ddd-hexagonal
description: >-
  Structure the extension as DDD-layered hexagons: src/domain/<context> owns
  the model and the ports, src/infra/<tech> adapts both sides, each runtime
  surface's entry point composes. ALWAYS use this skill when creating or
  renaming a module folder, adding an adapter/store/provider, introducing a
  bounded context, moving logic between layers, or answering "where does this
  code live?". Trigger on any mention of domain, port, adapter, repository,
  bounded context, hexagonal, DDD, or composition root.
---

# ddd-hexagonal

The folder graph IS the architecture. Every module wears its layer in its
path, and the import-boundary lint enforces the dependency direction. This
file is the rulebook for this repo (a Chrome MV3 extension: Vite + Svelte 5
+ TypeScript, three runtime surfaces).

## The shape

```
            driving (in)                            driven (out)
  sidepanel UI (Svelte) ─┐                    ┌─ infra/chrome-storage
  options UI (Svelte) ───┼─▶ src/domain/<ctx> ◀┼─ infra/ollama, infra/openai
  background handlers ───┘   owns: model,      ├─ infra/mcp (HTTP MCP client)
  (call the domain ports)    ports, error      └─ infra/webmcp (page-tool bridge)
                             vocabulary           (implement the domain's
                                                   store/gateway ports)

  composition roots — the ONLY modules that see concrete types:
    src/sidepanel/main.ts · src/options/main.ts · src/background/sw.ts
  Each surface wires the infra it needs into the domain ports and owns its
  runtime concerns (message listeners, panel lifecycle, alarms).
```

Dependencies point inward only: `composition root → infra/* → domain/*`
and `UI components → domain ports (types) only`. Nothing in `src/domain/*`
imports `chrome.*`, `fetch`, the DOM, Svelte, or another layer. Domain code
must run in a bare Node test with zero mocks of platform APIs.

## Naming

| Layer | Path | Rule |
| --- | --- | --- |
| Domain | `src/domain/<context>/` | one folder per bounded context (e.g. `chat`, `providers`, `tools`, `settings`); contexts plug together through ports, never by reaching into each other's files |
| Infrastructure | `src/infra/<tech>/` | named for the technology (`chrome-storage`, `ollama`, `openai`, `mcp`, `webmcp`, `chrome-runtime`), never for the domain; driving and driven adapters alike |
| UI (driving) | `src/sidepanel/`, `src/options/` | Svelte components + stores; talk to the domain only through injected ports |
| Composition | the three `main.ts`/`sw.ts` entry points | one per runtime surface; nothing else instantiates infra |

## Ports

- **Driving ports** are what adapters call: a TypeScript interface exported
  from the domain folder (`ChatApi`). UI/background code receives the
  interface — never a concrete class.
- **Driven ports** are what the domain needs from the world: also
  interfaces in the domain folder (`ChatStore`, `ModelGateway`), with a
  **domain-owned error vocabulary** — a discriminated union or typed error
  classes (`Unavailable`, `Conflict`, `Unexpected` with a `cause` kept for
  logging, never shown to callers). Infra adapters map their tech's errors
  INTO that vocabulary; the domain never sees a `DOMException`, an HTTP
  status, or `chrome.runtime.lastError`.
- Ports are async by default here (storage and network genuinely await),
  but keep pure domain logic (reducers, policy decisions, formatting) sync
  and free of ports entirely.
- Wiring is plain constructor/factory injection: a composition root builds
  the concrete adapter and passes it in. No service locator, no module-level
  singletons holding infra.

## Composition root duties (and ONLY its duties)

- Instantiate concrete infra (`createChromeStorageChatStore()`), inject
  into domain services and UI (via props/context or a wired store module).
- Own the runtime concerns of its surface: `chrome.runtime` message
  listeners, side-panel lifecycle, keep-alive/alarms, top-level error
  logging.
- The background worker is the arbiter for cross-surface state; UIs talk to
  it over the protocol adapter, not directly to each other.

## Tests per layer

| Layer | Test style |
| --- | --- |
| `src/domain/*` | plain Vitest unit tests, no platform APIs, no mocks of chrome/fetch |
| UI (driving) | component tests driving the component over a fake port (Vitest + Testing Library); no real background worker in the loop |
| `src/infra/*` (driven) | exercise the real technology cheaply (in-memory `chrome.storage` fake, stubbed `fetch`), assert the error mapping into the domain vocabulary |
| composition roots | stay thin enough that the smoke test is `npm run verify` (the Chrome-for-Testing harness) |

## Adding things — the recipes

- **New bounded context**: new `src/domain/<context>/` folder (model +
  ports + error vocabulary + unit tests). Existing infra composes it: the
  storage adapter adds its keys, the protocol adapter adds its messages.
  Wire in the entry points that need it. Record a decision if the context
  boundary is debatable.
- **New driving adapter** (new surface, command palette, keyboard API): it
  calls the existing driving ports; no domain change.
- **New store/gateway/provider**: new module in `src/infra/<tech>/`
  implementing the driven port, mapping errors into the domain vocabulary;
  swap it in the composition root — one line, nothing else moves.

## Smells → fixes

| Smell | Fix |
| --- | --- |
| `chrome.*`, `fetch`, or DOM APIs imported in `src/domain/*` | move the concern to an `src/infra/*` adapter behind a port |
| adapter imports another adapter | both talk to the domain port instead |
| concrete infra class constructed outside a composition root | inject the port interface |
| domain function returns/throws a raw fetch/chrome error | domain error vocabulary; adapter maps |
| business rule living in a Svelte component or store | push it through the port into the domain |
| "util"/"common"/"helpers" module | it's hiding a layer — name the layer or inline it |
| one UI surface importing another's modules | shared code lives in domain or infra, or stays duplicated until it earns a home |

`src/lib/components/ui/` (generated shadcn-svelte source) is vendored UI
kit, not our architecture — exempt from these rules, never imports domain.

## The lint

`npm run guard:boundaries` is the enforcement: `.dependency-cruiser.cjs`
(direction, cross-surface, barrel-only context edges — `.ts` and `.svelte`
alike) plus `scripts/guard-boundaries.mjs` for the platform GLOBALS
(`chrome.*`, `fetch`, `document`) that are not imports and so are invisible
to any import lint. Run it before you claim a move is done. Rules that are
not yet satisfiable — `src/lib` still holds infra pending cards 74-79 — are
written out and commented in that config, each naming the card that turns it
on; uncomment there rather than rewriting.

When a change genuinely needs to break one of these rules, that's a
decision record (`decisions/`), not a drive-by.

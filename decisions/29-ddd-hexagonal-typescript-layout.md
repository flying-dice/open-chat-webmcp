---
status: Accepted
date: 2026-08-22
---
# Decision 29 — DDD-hexagonal layout for src/

## Context

`src/lib` grew organically and is not a layered architecture: of its 18
modules only about seven are infrastructure-free. `session.ts` (~24
`chrome.storage` call sites), both registries, `ollama.ts`, `settings.ts`,
`permissions.ts`, `mcp/oauth.ts` and `mcp/client.ts` all embed
`chrome.storage` / `chrome.permissions` / `chrome.identity` / `fetch`
directly. `sidepanel/stores/panel.svelte.ts` (1,201 lines) mixes the session
aggregate, streaming state, page info, tool lists, connection status and
per-tab selection persistence, and 15 modules depend on it. Options
components call `chrome.*` directly (7 of 11). There is no compiler-enforced
crate graph as in the Rust origin of the `ddd-hexagonal` skill, so the
dependency direction needs a different enforcement mechanism.

## Decision

Adopt the ports-and-adapters layout defined in
`.claude/skills/ddd-hexagonal/SKILL.md` (the transformed, TypeScript
edition), with these repo-specific choices:

- **Bounded contexts** under `src/domain/`: `chat` (session aggregate,
  transcript, titles, turn phases), `providers` (provider config, selection,
  capability), `tools` (merge algebra, tool descriptors, approval policy),
  `settings` (approval policies). Pure TS only — no `chrome.*`, `fetch`,
  DOM, or Svelte imports.
- **Adapters** under `src/infra/`: `chrome-storage` (all storage
  repositories, including the sync/local credential split), `ollama`,
  `openai`, `mcp` (HTTP MCP client + OAuth), `chrome-runtime` (protocol
  messaging, tabs, permissions, identity), `webmcp` (content relay side).
- **Three composition roots**, one per runtime surface:
  `src/sidepanel/main.ts`, `src/options/main.ts`, `src/background/sw.ts`.
  Provider-type registration moves from side-effect imports to explicit
  wiring in each root, eliminating the latent "unregistered type" throw.
- **Enforcement**: `dependency-cruiser` with rules encoding
  `roots → infra → domain`, no domain→infra/UI edges, no cross-surface
  imports, run as `npm run guard:boundaries` and required by the pre-commit
  skill. The compiler can't enforce the direction; the lint does.
- The god-store is split along context lines; UI stores keep only view
  state and delegate to domain services injected at the composition root.

## Consequences

- Domain logic becomes unit-testable without platform mocks (prerequisite
  for Decision 30's test pyramid).
- The known layering inversions are dissolved rather than patched:
  `session.ts` re-exporting registry types, `oauth.ts` writing to the
  registry from inside the transport stack, presentation strings
  (`capabilityBadge`, `originLabel`) in domain modules, `presets.ts`
  depending on the icon set.
- Pre-release status (Decision: no migrations — see memory) means storage
  shapes may be cleaned up freely while extracting repositories; the legacy
  `session:*` migration code is deleted, not ported.
- The move is mechanical but wide; it lands as a sequence of per-context
  board cards, each leaving `npm run check`, `npm run build` and the verify
  harness green.

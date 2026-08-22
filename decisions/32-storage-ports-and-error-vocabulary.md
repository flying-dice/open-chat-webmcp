---
status: Accepted
date: 2026-08-22
---
# Decision 32 — Storage ports: one error vocabulary, one keyed-record mechanic

> **PARTIALLY SUPERSEDED by decisions/34-errors-as-values.md (card 92) —
> DELIVERY ONLY.** The "It **throws** rather than returning a result union"
> paragraph below no longer holds: every storage port returns
> `Result<T, StorageError>` (`src/domain/result.ts`), and
> `src/infra/chrome-storage/area.ts` maps a platform failure into a
> `fail(...)` instead of a `throw`. Everything else here stands unchanged and
> is still the current design — the `StorageError` vocabulary and its five
> kinds, `src/domain/storage` as a shared kernel that is not a bounded
> context, the two-registries-one-mechanic split, the sync/local credential
> split enforced by shape, and the `ProviderDefaultsStore` /
> `ModelCapabilityCache` split by kind. Read the throwing paragraph as the
> reasoning that was true at the time; decision 34 explains why it stopped
> being.

## Context

Card 74 pulled four `chrome.storage` repositories out of `src/lib` and behind
driven ports, per `decisions/29-ddd-hexagonal-typescript-layout.md`. Three
choices came up that decision 29 does not settle, and that later cards (75-79)
would otherwise each answer differently.

1. **Where the storage-error vocabulary lives.** Decision 29 says a driven port
   carries "a domain-owned error vocabulary". Four ports in four bounded
   contexts (`chat`, `providers`, `tools`, `settings`) would mean four copies of
   the same five-member union, and four places for an adapter to map
   `chrome.runtime.lastError` into.
2. **Whether the two registries stay separate implementations.**
   `src/lib/providers/registry.ts` (398 lines) and `src/lib/mcp/registry.ts`
   (395) were the same module twice, including the sync/local credential split
   that decisions/10 and 15 mandate — so that rule was implemented twice and
   could be broken independently in either copy. But they are two distinct
   domain concepts with genuinely different fields, defaults and side rules.
3. **Where Ollama's private store goes.** `src/lib/ollama.ts` kept
   `ollama:baseUrl` and `ollama:cap:<digest>` in `chrome.storage.local` itself,
   reached for from the middle of a wire client — the transport/persistence
   mixing decision 29 names. Card 75 moves that client to `src/infra/ollama`,
   where importing another adapter would break
   `adapters-do-not-import-adapters`.

## Decision

**One error vocabulary, in a shared kernel.** `src/domain/storage` holds
`StorageErrorKind` (`Unavailable | NotFound | Conflict | Corrupt | Unexpected`)
and the `StorageError` that carries it, with the platform's own error kept on
`cause`. It is explicitly NOT a bounded context — it models no part of the
problem domain — and nothing else may be added to it. Every storage port in
every context rejects with that type and nothing else;
`src/infra/chrome-storage/area.ts` is the single place the mapping happens.

It **throws** rather than returning a result union: every one of these ports
already rejected on a storage failure before card 74, and no caller anywhere
handles that rejection. Turning them into values would have changed every call
site's control flow inside a refactor billed as behaviour-preserving.
*(Superseded by decision 34, card 92: exactly that change, made deliberately
and on its own card. The vocabulary is untouched; only its delivery moved from
`throw` to the error member of a `Result<T, StorageError>`.)*

**Two ports, one mechanic.** `ProviderRegistry` (`src/domain/providers`) and
`McpServerRegistry` (`src/domain/tools`) stay two distinct domain ports. Their
shared machinery — an ordered core list under one key in `chrome.storage.sync`,
plus per-id credential parts under `chrome.storage.local` — is written once as
`src/infra/chrome-storage/keyed-record-store.ts`, which both adapters
configure. A credential becomes a `parts` entry, and a part structurally cannot
reach the sync area. What each registry does on TOP of the mechanic (providers
clearing the default selection on removal; MCP servers defaulting
`enabled`/`transport`) stays in its own adapter rather than becoming shared
hook plumbing.

**Ollama's store splits by kind, not by provider.** A base URL is
configuration and lands with the provider settings as `ProviderDefaultsStore`,
keyed by `ProviderType` (`<type>:baseUrl`). A capability answer is a derived,
disposable cache and gets its own small port, `ModelCapabilityCache`
(`<type>:cap:<fingerprint>`). For `"ollama"` both key shapes are byte-identical
to what was there before. The wire client takes both as injected options,
supplied at the one provider-registration site, so it holds no store itself.

## Consequences

- A caller can `catch` one type and branch on `kind`; an adapter has one target
  to map into. Adding a fifth repository adds no new vocabulary.
- The credential split is enforced by shape rather than by discipline, and is
  covered by `guard:boundaries`'s new storage-containment scan: `chrome.storage`
  may be called only from `src/infra/chrome-storage/`, with named per-card
  exceptions listed in `scripts/guard-boundaries.mjs`.
- `src/domain/storage` is a precedent that could be abused as a dumping ground
  for "shared domain". Its README says so explicitly; a second shared kernel
  needs its own decision.
- The keyed-record store is generic over its record type, which costs some type
  gymnastics in the adapters (`decodeCore` returning `TCore | undefined` rather
  than a type predicate). That is the price of the split being unbreakable.
- Legacy `session:*` migration was DELETED rather than ported (pre-release, no
  migrations). Any surviving keys in a developer profile are inert.

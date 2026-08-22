---
status: Accepted
date: 2026-08-23
---
# Decision 34 — Errors as values: result tuples in signatures, throw only for the unexpected

## Context

Error handling is split three ways today: the MCP stack returns
`McpResult<T>` (never-throws), the provider stack returns
`ProviderResult<T>`, and the storage ports **throw** `StorageError`
(Decision 32 chose throwing because every caller already rejected). Nothing
in a function's signature tells a caller which known failures to expect
unless the author picked one of the two Result unions, and `throw` is used
for both expected failures (storage unavailable) and genuine bugs
(exhaustiveness violations). Jonathan has asked for the checked-exceptions
concept done Go/Lua-style: known failure modes are values in the return
type, and `throw` is reserved for genuinely unexpected outcomes.

## Decision

- One shared result shape in the domain, Go-style tuple with union
  narrowing:

  ```ts
  type Result<T, E> = readonly [value: T, error: undefined]
                    | readonly [value: undefined, error: E];
  ```

  `const [value, err] = await port.load(id); if (err) { … }` narrows both
  sides. Constructors `ok(value)` / `fail(error)` live beside it in
  `src/domain/result.ts` (a shared kernel like `domain/storage`).
- **Every known failure mode is in the signature.** A function that can
  fail in an expected way returns `Result<T, SomeErrorVocabulary>`; the
  error vocabularies (StorageError, ProviderError, McpError, …) stay —
  only their delivery changes from `throw`/bespoke unions to the shared
  tuple. `McpResult` and `ProviderResult` migrate onto it.
- **`throw` means a bug.** Allowed only for programmer-error assertions
  (exhaustiveness checks, violated invariants) — the cases where crashing
  and being reported is correct because the state is unreasonable. Every
  surviving `throw` site must be justifiable as "this cannot happen unless
  the code is wrong"; adapters never let a platform exception escape — they
  catch at the boundary and map into the vocabulary (`Unexpected` with
  `cause` retained).
- Enforced mechanically: `npm run guard:throws` inventories every `throw`
  (and `Promise.reject`) under `src/`, failing on any site not on a
  reviewed allowlist that names its invariant. The allowlist lives in the
  guard config, is expected to be short, and grows only with justification.
- Supersedes the throwing-ports choice in Decision 32 (its sync/local
  credential split and error vocabulary are untouched). The
  `ddd-hexagonal` skill's Ports section is updated to match.

## Consequences

- Callers stop needing to know out-of-band which functions throw; the
  compiler forces handling (or explicit propagation) of every known
  failure.
- The storage ports and their ~25 call sites migrate from try/catch to
  tuple checks — mechanical but wide; pre-release status means no
  compatibility shims.
- Tests assert on returned errors instead of `rejects.toThrow`, which
  reads better and removes a class of unhandled-rejection flakes.
- Vendored shadcn kit (`src/ui/components/ui/`) is exempt as always.

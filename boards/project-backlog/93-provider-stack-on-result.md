---
column: todo
labels: [backend]
priority: high
updatedAt: 2026-08-23T10:00:00.000Z
---
# Provider stack on the shared result tuple

Migrate `ProviderResult<T>` and the provider surfaces onto
`Result<T, ProviderError>` per decisions/34-errors-as-values.md: the
`ChatProvider` interface (src/domain/providers/provider.ts), the ollama and
openai adapters (including the streaming chat generator's failure delivery
— design the tuple shape for async iteration deliberately and document it),
capability probing, the client factory, and their callers (chat turn
engine's ModelGateway port, selection store's model loading, options
test-connection). Known wire failures (401/403/404/429, unreachable,
malformed stream) are values; only invariant violations still throw.

## Checklist

- [ ] ProviderResult replaced by the shared Result; ChatProvider + ModelGateway signatures carry typed errors end to end
- [ ] Streaming failure delivery redesigned as values (documented at the generator); mid-stream faults reach the turn engine as data, not exceptions
- [ ] ollama + openai adapters catch at the fetch boundary only; guard:throws entries for both removed
- [ ] All callers migrated; provider/infra/component tests updated to assert error values
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

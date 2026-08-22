---
column: todo
labels: [backend]
priority: high
updatedAt: 2026-08-23T10:00:00.000Z
---
# Result kernel and storage ports on error tuples

Introduce the shared result tuple and migrate the storage stack off
throwing, per decisions/34-errors-as-values.md (which supersedes decision
32's throwing-ports choice — the error vocabulary and credential split stay
exactly as they are). Update .claude/skills/ddd-hexagonal/SKILL.md's Ports
section to describe errors-as-values delivery.

## Checklist

- [ ] `src/domain/result.ts` shared kernel: `Result<T, E>` union-of-tuples with `ok()`/`fail()` constructors and narrowing proven by unit tests
- [ ] All storage ports (ChatStore, ProviderRegistry, McpServerRegistry, SettingsStore, ProviderDefaultsStore, ModelCapabilityCache, McpAuthTokenStore) return `Result<T, StorageError>`; adapters in src/infra/chrome-storage stop throwing — platform failures map at the boundary, nothing escapes
- [ ] Every port caller (services, stores, composition roots) migrated from try/catch to tuple checks; behaviour identical (best-effort paths stay best-effort)
- [ ] Storage tests assert on returned errors instead of rejects/throws; fixtures round-trip test updated
- [ ] guard:throws allowlist shrinks by every storage-stack entry; remaining src/infra/chrome-storage throws = zero
- [ ] ddd-hexagonal skill Ports section updated; decision 32 annotated as partially superseded by 34
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

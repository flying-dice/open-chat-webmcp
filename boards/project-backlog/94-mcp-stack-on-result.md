---
column: todo
labels: [backend]
priority: med
updatedAt: 2026-08-23T10:00:00.000Z
---
# MCP stack on the shared result tuple

Migrate `McpResult<T>` onto the shared `Result<T, McpError>` per
decisions/34-errors-as-values.md. The MCP stack already has never-throws
discipline, so this is largely a mechanical re-shape of
src/domain/tools/{types,gateway,sign-in}.ts and src/infra/mcp/* plus their
consumers (sidepanel mcp services, options test-connection, McpServerForm's
sign-in service) — but audit the internals while there: any internal throw
used for control flow between transport modules becomes a value, and the
oauth flow's known failures (discovery absent, registration rejected,
refresh expired, user-cancelled) must each be distinct vocabulary members
visible in signatures.

## Checklist

- [ ] McpResult replaced by the shared Result across domain/tools and infra/mcp; signatures carry McpError end to end
- [ ] OAuth known-failure vocabulary audited and complete; sign-in service surfaces them as values
- [ ] Internal control-flow throws between transport modules eliminated; guard:throws entries for infra/mcp reduced to boundary-catch invariants only
- [ ] All consumers and the 300+ MCP tests migrated to tuple assertions
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

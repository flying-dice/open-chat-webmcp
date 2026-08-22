---
column: todo
labels: [bug, backend]
priority: high
updatedAt: 2026-08-23T06:30:00.000Z
---
# Fix the three pinned domain bugs

The test phase pinned three real defects with failing/regression tests;
fix them so the pins go green. Per .claude/skills/ddd-hexagonal/SKILL.md all
three live in the domain layer, so fixes are pure and unit-testable.

1. **Duplicate tool-call ids clobber results** (src/domain/chat/message.ts:147,
   src/domain/chat/service.ts:232; pinned `it.fails` in turn.test.ts): a model
   emitting two tool calls with the same id makes the second result overwrite
   the first and strands the second entry as `pending` forever. Key results by
   position or a disambiguated id.
2. **Concurrent second turn clobbers live/stop registration**
   (src/domain/chat/service.ts:450-481; pinned `it.fails` in service.test.ts):
   a second turn starting while one is in flight lets the first turn's
   `finally` clear the second's registration. Either reject the second turn
   cleanly or make registration turn-scoped.
3. **disambiguateName fails at the truncation ceiling**
   (src/domain/tools/merge.ts:145-154; pinned regression test in
   merge.test.ts): two server tools whose namespaced names both truncate to
   the 64-char ceiling collide; the disambiguation suffix is truncated away,
   leaving the second tool unreachable. Reserve suffix room when truncating.

Also resolve the two `it.todo` undecided behaviours from card 85: decide the
intended behaviour (smallest honest semantics), implement or document, and
turn each todo into a real test.

## Checklist

- [ ] All three pinned tests flipped from it.fails/regression-pin to green assertions of correct behaviour
- [ ] The two it.todo cases decided, implemented, and asserted
- [ ] No behaviour change beyond the fixes; chaos suites still green
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

---
column: todo
labels: [infra, backend]
priority: med
updatedAt: 2026-08-22T13:40:00.000Z
---
# Refactor to a green guard

Clear the clean-code marker backlog until `npm run guard` passes. Per
decisions/31-clean-code-guard.md the loop has an objective exit condition: no
`TODO: clean-code -` marker scoring >0.5 anywhere in `src/` (excluding the
vendored `src/lib/components/ui/` kit), `dependency-cruiser` boundaries clean, and
a fresh full `clean-code-review` audit producing no NEW >0.5 findings. Work it
with `.claude/skills/refactor/SKILL.md`: highest-scored marker first, one marker
per pass, nothing else touched — the loop supplies the repetition. Markers ≤0.5
stay in the code as documented, accepted debt.

## Checklist

- [ ] the refactor skill is run as a loop — highest-scored marker picked, fixed, marker removed, stop; no opportunistic edits ride along in a pass
- [ ] every pass ends with `npm run check` and `npm run build` green before the next marker is picked, so a broken pass is attributable to one change
- [ ] markers ≤0.5 deliberately left in place, each carrying a one-line justification in the marker text so the guard output reads as a debt register rather than noise
- [ ] `npm run guard` (guard:clean-code + guard:boundaries) exits 0 — no >0.5 marker remains outside the excluded UI kit and no boundary rule is violated
- [ ] a fresh full `clean-code-review` audit re-run at the end produces no NEW >0.5 findings; anything it does find is fixed and the audit repeated until it comes back clean (Decision 31's exit condition)
- [ ] behaviour is unchanged: the verify scenarios (7 demo fixtures discovered, registry cleared on nav, dynamic register/unregister, SW kill and live registry rebuild, timeout ladder, three-state availability) all still pass
- [ ] `## Comments` journals each cleared marker with its `path:line`, score and category, so the debt that was paid is visible without re-deriving it
- [ ] npm run check, npm run build and npm run verify green

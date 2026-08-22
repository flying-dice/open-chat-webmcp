---
column: todo
labels: [infra, docs]
priority: med
updatedAt: 2026-08-23T06:30:00.000Z
---
# Accepted-debt burn-down and live smoke

Final improvement-sprint card. Two halves:

**Debt burn-down.** ~96 accepted `TODO: clean-code` markers (≤0.5) remain by
design (decisions/31). Burn down the cheap, high-value tail — every NAMING
marker that is a stale doc-comment path (fix the comment, delete the
marker), the `src/{sidepanel,options}/lib/` directory names that kept the
generic `lib` name decision 33 retired elsewhere (rename if the churn is
small), and any DRY/COUPLING marker whose shared helper now exists from
card 81's extractions. Leave genuinely-debatable markers in place — the
guard reports them; that's the system working. Target: meaningfully fewer
markers, zero new ones.

**Live smoke.** The flagged human-verification items, automated where
possible against a real local Ollama (it was reachable in earlier cards):
one real end-to-end turn in the launched extension (send → stream → reply
rendered; a page-tool call if the demo page is used), plus the options-form
smoke card 81 requested (add/edit provider and MCP server, header rows,
reserved-name error, Show/Hide, test connection). Use the verify harness
style (Chrome for Testing + Playwright). Record outcomes in the journal;
anything broken becomes a new bug card, not a drive-by fix.

## Checklist

- [ ] Stale-path NAMING markers fixed and removed; marker count reduced and journalled (before/after)
- [ ] lib/ directory naming resolved or explicitly accepted with reasoning
- [ ] Live end-to-end turn against a real model recorded (or blocked-on-environment journalled)
- [ ] Options-form smoke executed and recorded
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

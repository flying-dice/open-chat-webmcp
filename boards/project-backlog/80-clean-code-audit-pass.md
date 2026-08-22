---
column: todo
labels: [infra]
priority: med
updatedAt: 2026-08-22T13:35:00.000Z
---
# Clean-code audit pass over all of src/

Run `.claude/skills/clean-code-review/SKILL.md` as a full multi-agent audit over
the WHOLE of `src/` — not the current diff. This is the adoption pass that gives
decisions/31-clean-code-guard.md its starting marker set, so the proportionality
gate is settled up front: full audit, all six agents. Nothing is fixed in this
card; the output is `TODO: clean-code - <score> - <CATEGORY>: <description>`
markers at the violation sites plus a count per category. The coupling hot-spots
named in the architecture map are the obvious targets — mcp/client.ts (1294),
panel.svelte.ts (1201), agentLoop.ts (842), session.ts (814) — but the sweep must
cover every file so the guard's baseline is honest.

## Checklist

- [ ] all six agents (SRP, DRY, Naming, Coupling, Dead code, KISS) run over the whole of `src/`, each reporting file, line range, description and a 0-1 severity; the file set each agent covered is recorded so the sweep is provably complete
- [ ] `src/lib/components/ui/` (vendored shadcn-svelte source) and framework-mandated Svelte/Vite/MV3 boilerplate excluded, per Decision 31 and the skill's ignore list
- [ ] the largest and most-coupled modules are explicitly covered: mcp/client.ts (1294), panel.svelte.ts (1201), agentLoop.ts (842), session.ts (814), providers/openai.ts (762), ProviderPicker.svelte (759), ollama.ts (746), McpServerForm.svelte (728), mcp/oauth.ts (602), selection.svelte.ts (498)
- [ ] known structural duplication is caught rather than assumed: the two near-identical registries, the two permission re-export shims, the two `testResultDisplay` modules, the ProviderForm/McpServerForm and ProviderRow/McpServerRow mirrors
- [ ] every finding >0.5 written at its site as `// TODO: clean-code - <score> - <CAT>: <description>` (the `<!-- -->` form inside Svelte markup); findings ≤0.5 written too, so `npm run guard:clean-code` reports them as accepted debt
- [ ] no code fixed in this card — `git diff` shows comment-only hunks
- [ ] counts per category (>0.5 and ≤0.5) plus the top ten by score journalled into this card's `## Comments` with `path:line` for each
- [ ] npm run check, npm run build and npm run verify green (`npm run guard:clean-code` is expected to FAIL here — that failure is this card's deliverable, cleared by the next card)

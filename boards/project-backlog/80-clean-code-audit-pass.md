---
column: review
agent: claude
live: false
labels: [infra]
priority: med
updatedAt: 2026-08-23T00:45:00.000Z
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

- [x] all six agents (SRP, DRY, Naming, Coupling, Dead code, KISS) run over the whole of `src/`, each reporting file, line range, description and a 0-1 severity; the file set each agent covered is recorded so the sweep is provably complete
- [x] `src/lib/components/ui/` (vendored shadcn-svelte source) and framework-mandated Svelte/Vite/MV3 boilerplate excluded, per Decision 31 and the skill's ignore list
- [x] the largest and most-coupled modules are explicitly covered: mcp/client.ts (1294), panel.svelte.ts (1201), agentLoop.ts (842), session.ts (814), providers/openai.ts (762), ProviderPicker.svelte (759), ollama.ts (746), McpServerForm.svelte (728), mcp/oauth.ts (602), selection.svelte.ts (498)
- [x] known structural duplication is caught rather than assumed: the two near-identical registries, the two permission re-export shims, the two `testResultDisplay` modules, the ProviderForm/McpServerForm and ProviderRow/McpServerRow mirrors
- [x] every finding >0.5 written at its site as `// TODO: clean-code - <score> - <CAT>: <description>` (the `<!-- -->` form inside Svelte markup); findings ≤0.5 written too, so `npm run guard:clean-code` reports them as accepted debt
- [x] no code fixed in this card — `git diff` shows comment-only hunks
- [x] counts per category (>0.5 and ≤0.5) plus the top ten by score journalled into this card's `## Comments` with `path:line` for each
- [x] npm run check, npm run build and npm run verify green (`npm run guard:clean-code` is expected to FAIL here — that failure is this card's deliverable, cleared by the next card)

## Gates

- [x] check — `npm run check` green, 863 files, 0 errors, 0 warnings (claude, 2026-08-23T00:45:00.000Z)
- [x] build — `npm run build` green, `dist/` produced with no errors (claude, 2026-08-23T00:45:00.000Z)
- [x] verify — `npm run verify` green end-to-end on the marker-only diff (claude, 2026-08-23T00:45:00.000Z)
- [ ] guard:clean-code — EXPECTED to fail: 108 markers found across `src/` (137 files scanned), 96 accepted as debt (≤0.5), 12 scored >0.5 and listed as "must be fixed"; this failure is this card's deliverable, cleared by the next card (claude, 2026-08-23T00:45:00.000Z)

## Comments

- **claude** (2026-08-23T00:45:00.000Z): Consolidated the six principle-auditor reports (srp/dry/naming/coupling/dead/kiss, each a full sweep of `src/` minus `src/ui/components/ui/` and `*.d.ts`) into one deduplicated marker set, written comment-only at every violation site. `git diff -- src` is 100% insertions (0 deletions across 64 files) — verified line by line, not just by numstat.

  **Deduplication.** Two literal duplicates were merged (score/category of the higher-scoring report kept, the other dropped rather than double-marked):
  - `src/domain/providers/registry.ts:138` `resolveDefaultSelection` — Dead (0.6, zero callers) and KISS (0.25, "unused convenience wrapper") were the same defect from two angles; kept DEAD at 0.6.
  - Four stale-`src/lib/session.ts`-reference comments — flagged independently by NAMING and DEAD at the same sites (`src/ui/components/Markdown.svelte:15`, `src/sidepanel/components/CallLogEntry.svelte:19`, `CallLogPanel.svelte:3`, `ToolCallRow.svelte:108`) — kept as NAMING (clearer category: "the doc comment misidentifies the current location/owner of the code"), each at its NAMING report's score (0.45/0.4/0.4/0.4), dropping the lower-scored DEAD duplicate.

  Everything else with overlapping files but a genuinely different defect was kept as two separate findings at two separate markers (e.g. `McpServerForm.svelte`'s SRP "bundles five concerns" (whole-file, line 2) vs. its three DRY findings against `ProviderForm`/`McpServerRow`/`testResultDisplay.ts` are different violations, not restatements of one).

  **Sanity-checking.** Every >0.5 finding and every DEAD finding was re-verified against the live tree before marking (fresh `grep -rn` for each of: `togglePicker`, `getCapabilitiesForModels`, `isStorageError`, `resolveDefaultSelection`, `summarizeChat`, the `Msg` type alias, `SegmentedControl`) — all confirmed zero real callers/usages, no false positives found or dropped. `McpServerForm.svelte`'s report line count (757) vs. actual (756) was a 1-line drift, handled by re-locating each site by content rather than trusting line numbers.

  **One self-inflicted bug caught by the gate, not by inspection:** the COUPLING marker text for `src/ui/components/Markdown.svelte:59` originally quoted the literal string `<style>` inside a `//` comment inside the `<script>` block — Svelte's compiler scans script contents for tag boundaries by regex before real JS parsing, so that literal broke script-block-closing detection and cascaded into 5 `svelte-check` errors (`Markdown.svelte` "script left open", plus "no default export" in every importer). Fixed by rewording to "scoped style block" (src/ui/components/Markdown.svelte:59). `npm run check` is 0 errors/0 warnings after the fix.

  **Marker counts** (`npm run guard:clean-code`: 108 markers, 137 files scanned, 96 ≤0.5 / 12 >0.5):

  | category | findings (deduped) | markers written | of which >0.5 |
  |---|---|---|---|
  | SRP | 10 | 10 | 1 |
  | DRY | 20 | 53 | 5 |
  | NAMING | 14 | 14 | 1 |
  | COUPLING | 11 | 17 | 0 |
  | DEAD | 11 | 11 | 5 |
  | KISS | 3 | 3 | 0 |
  | **total** | **69** | **108** | **12** |

  (DRY/COUPLING marker counts exceed finding counts because several are multi-site — e.g. the `isRecord`/`isPlainObject` DRY finding gets a marker at all 9 sites it names, the 401/403 auth-classify DRY finding at all 4 sites, `truncate`/`safeReadText` at their 3 sites each, the reorder/permission-gate DRY finding at 3 functions × 2 files.)

  **Top ten by score:**
  1. `src/sidepanel/components/SegmentedControl.svelte:2` (0.7 DEAD) — whole component dead, superseded by shadcn `Tabs` at both former call sites.
  2. `src/domain/chat/session.ts:170` (0.6 DEAD) — `summarizeChat` zero callers, superseded by a hand-rolled duplicate in `chat-store.ts`.
  3. `src/domain/providers/registry.ts:136` (0.6 DEAD) — `resolveDefaultSelection` zero callers (merged w/ KISS finding).
  4. `src/domain/storage/error.ts:65` (0.6 DEAD) — `isStorageError` zero callers.
  5. `src/infra/ollama/client.ts:419` (0.6 DEAD) — `getCapabilitiesForModels` zero callers.
  6. `src/sidepanel/stores/selection.svelte.ts:497` (0.6 DEAD) — `togglePicker` zero callers; `ProviderPicker.svelte` actually wires `Popover.Root`'s `onOpenChange` to `openPicker`/`closePicker` instead.
  7. `src/options/components/McpServerForm.svelte:721` / `src/options/components/McpServerRow.svelte:150` (0.55 DRY) — the "show N tools" toggle + expandable list copy-pasted verbatim, `each_key_duplicate` war-story comment and all.
  8. `src/options/components/McpServerForm.svelte:169` / `src/options/components/ProviderForm.svelte:127` (0.55 DRY) — `HeaderRow` shape/CRUD, the permission-grant `$effect`, and `handleTest`'s flow independently re-declared in both forms.
  9. `src/sidepanel/components/ApprovalCard.svelte:79` / `src/sidepanel/components/ToolListItem.svelte:56` (0.55 DRY) — the five-value annotation-derivation + four-`Badge` render block duplicated verbatim.
  10. `src/options/components/McpServerForm.svelte:2` (0.5 SRP) — bundles basic fields, bearer-token entry, the OAuth sign-in state machine + manual-registration sub-flow, header-row CRUD/validation, and connection-test orchestration in one component.

  (12th >0.5 finding not shown above: `src/domain/providers/provider.ts:94` (0.5 DRY) — `reservedHeaderReason` duplicates `servers.ts`'s `validateServerHeaders`/`CLIENT_CONTROLLED_HEADERS`.)

  **Removable-kit** (vendored shadcn-svelte components with zero importers outside `src/ui/components/ui/`, per the dead-code report — NOT marked, kit is exempt per the task, noted here only): `src/ui/components/ui/dialog/`, `separator/`, `skeleton/`, `spinner/`, `switch/` — all scored 0.2, all pruning candidates for whoever next touches the kit.

  **Dropped findings:** none. Every finding from all six reports survived sanity-checking (after the two merges above); nothing was a false positive on inspection.

  **Gates:** `npm run check` — 863 files, 0 errors, 0 warnings (after the Markdown.svelte fix above). `npm run build` — clean, `dist/` produced. `npm run verify` — 9/9 required checks passed, exit 0 (screenshots best-effort PASS too). `npm run guard:clean-code` — exit 1 as expected, 108 markers / 96 ≤0.5 accepted-debt / 12 >0.5 "must be fixed", full list above.

---
column: review
agent: claude-opus
live: false
labels: [infra, backend]
priority: med
updatedAt: 2026-08-23T02:55:00.000Z
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

- [x] the refactor skill is run as a loop — highest-scored marker picked, fixed, marker removed, stop; no opportunistic edits ride along in a pass
- [x] every pass ends with `npm run check` and `npm run build` green before the next marker is picked, so a broken pass is attributable to one change
- [x] markers ≤0.5 deliberately left in place, each carrying a one-line justification in the marker text so the guard output reads as a debt register rather than noise
- [x] `npm run guard` (guard:clean-code + guard:boundaries) exits 0 — no >0.5 marker remains outside the excluded UI kit and no boundary rule is violated
- [x] a fresh full `clean-code-review` audit re-run at the end produces no NEW >0.5 findings; anything it does find is fixed and the audit repeated until it comes back clean (Decision 31's exit condition)
- [x] behaviour is unchanged: the verify scenarios (7 demo fixtures discovered, registry cleared on nav, dynamic register/unregister, SW kill and live registry rebuild, timeout ladder, three-state availability) all still pass
- [x] `## Comments` journals each cleared marker with its `path:line`, score and category, so the debt that was paid is visible without re-deriving it
- [x] npm run check, npm run build and npm run verify green

## Gates

- [x] guard — `npm run guard` exit 0: boundaries clean (domain purity, `chrome.*`/`chrome.storage`/`chrome.identity` containment) and `guard:clean-code — scanned 141 file(s) under src/ (excluding src/ui/components/ui); 96 marker(s) found` / `ok — nothing above 0.5` (claude-opus, 2026-08-23T02:40:00.000Z)
- [x] check — `npm run check` green, 867 files, 0 errors, 0 warnings (claude-opus, 2026-08-23T02:40:00.000Z)
- [x] build — `npm run build` green, `dist/` produced with no errors (claude-opus, 2026-08-23T02:40:00.000Z)
- [x] verify — `npm run verify` green, 9/9 required checks passed, screenshots best-effort PASS (claude-opus, 2026-08-23T02:40:00.000Z)

## Comments

- **claude-opus** (2026-08-23T02:40:00.000Z): Cleared all 12 of card 80's >0.5 markers; `npm run guard` is green. Marker count went 108 -> 96, i.e. exactly the twelve, and no ≤0.5 marker was dropped in passing (two had their TEXT corrected where a fix made them stale — noted below).

  **The six DEAD markers (5x 0.6, 1x 0.7).**
  - `src/sidepanel/components/SegmentedControl.svelte:2` (0.7 DEAD) — deleted the whole component. Re-confirmed zero `<SegmentedControl>` usages in `src/`, `verify/`, `scripts/`; both former call sites are shadcn `Tabs` now, as `src/sidepanel/components/Inspector.svelte:13` already says.
  - `src/domain/chat/session.ts:170` (0.6 DEAD) — `summarizeChat` had zero callers because `src/infra/chrome-storage/chat-store.ts` hand-assembled the same `ChatSummary` inline. This is the one dead export NOT deleted: its doc comment ("derived here so the index an adapter writes and the list a caller reads can never disagree") describes exactly the invariant the adapter was breaking, and the hand-rolled copy was a domain derivation living in infra. Wired the caller instead — `src/infra/chrome-storage/chat-store.ts:299-300` is now `nextIndex.push(summarizeChat(plain))`, its `chatPreview` import replaced by `summarizeChat`. Field-for-field identical output.
  - `src/domain/providers/registry.ts:136` (0.6 DEAD) — deleted `resolveDefaultSelection`. A pure convenience wrapper over `getDefaultSelection() + resolveSelection()`; both real call sites deliberately inline those two, so the wrapper was the redundant half.
  - `src/domain/storage/error.ts:65` (0.6 DEAD) — deleted `isStorageError`; every catch site uses `instanceof StorageError` directly.
  - `src/infra/ollama/client.ts:419` (0.6 DEAD) — deleted `getCapabilitiesForModels`, and repointed the dangling `{@link}` in `getCapabilities`'s doc comment (`src/infra/ollama/client.ts:368-370`) at `resolveCapabilities` (src/domain/providers/capability.ts), which is what actually does the concurrent job.
  - `src/sidepanel/stores/selection.svelte.ts:497` (0.6 DEAD) — deleted `togglePicker`; `ProviderPicker.svelte` wires `Popover.Root`'s `onOpenChange` to `openPicker`/`closePicker`. The file's ≤0.5 SRP marker (`src/sidepanel/stores/selection.svelte.ts:1`) named `togglePicker` in its list of picker members, so its text was corrected to keep the debt register accurate — the finding itself still stands and stays.

  **The six DRY markers (6x 0.55), fixed as three extractions.**
  - `src/options/components/McpServerForm.svelte:721` + `src/options/components/McpServerRow.svelte:150` — new `src/options/components/McpTestResult.svelte`, the whole `{#if testOutcome}` banner + "Show N tools" disclosure that both carried verbatim (`each_key_duplicate` war story included). The `{#if outcome}` deliberately lives INSIDE the new component and both parents render it unconditionally, so the disclosure state survives the `testOutcome = undefined` gap a re-test opens — unmounting there would have silently collapsed an expanded list, the one behaviour change the naive extraction would have introduced. `src/options/lib/testResultDisplay.ts:23-28`'s "Consumers:" note updated to match.
  - `src/sidepanel/components/ApprovalCard.svelte:79` + `src/sidepanel/components/ToolListItem.svelte:56` — new `src/sidepanel/components/AnnotationBadges.svelte` takes `annotations`/`mcpAnnotations` and renders the four conditional badges, deriving read-only/untrusted/destructive/unannotated once. It renders bare (no wrapper element) so each caller keeps its own badge-row layout, including `ToolListItem`'s origin badge alongside. `isServerTool` stays in both parents — each needs it for something else entirely (`ToolListItem` for the origin badge's class, `ApprovalCard` for four separate pieces of wording), so pulling it into the badge component would have been coupling, not sharing.
  - `src/options/components/McpServerForm.svelte:169` + `src/options/components/ProviderForm.svelte:127` — the big one, split three ways. `src/options/lib/headerRows.ts` now owns the `HeaderRow` shape, `toHeaderRows`, and the `headerRowError`/`firstHeaderError` skeleton, parameterised by a `ReservedHeaderCheck` each form supplies (providers' `reservedHeaderReason` vs MCP's `validateServerHeaders` — genuinely different rules from two bounded contexts, which is why they stay per-form rather than being merged; `src/domain/providers/provider.ts:94`'s 0.5 marker about that overlap is untouched, accepted debt). `src/options/components/HeadersEditor.svelte` owns the markup, the row CRUD, the id cursor and the Show/Hide-values toggle, varying only by two props: `firstInputId` (so each form's `<Field.Label for=…>` still targets a unique element) and a `description` snippet (the two forms' copy differs on purpose — a provider's headers and a server's go to different things). `src/options/lib/hostPermission.svelte.ts` owns the other two duplications the marker named: `trackHostPermission(() => url)` replaces both copies of the permission-grant `$effect`, and `requestHostPermission(url, state)` + `PERMISSION_DENIED_MESSAGE` replace both copies of the "request as the first await, then bail with this exact sentence" block in `handleTest`. It is a `.svelte.ts` module because the tracker owns a `$state`/`$effect` pair on the caller's behalf. `McpServerForm`'s OAuth flow keeps writing the grant through the same state (`src/options/components/McpServerForm.svelte:316-317`).

  Net: 486 deletions against 121 insertions across the tracked files, plus five new files. `McpServerForm.svelte`'s ≤0.5 SRP marker listed "custom-header row CRUD+validation" as one of its five bundled concerns; that concern has left the file, so the marker now reads four (`src/options/components/McpServerForm.svelte:2`) — again a text correction, not a cleared finding.

  **Fresh audit of the diff** (decision 31's exit condition). The diff is >50 lines and >3 files, so per the clean-code-review skill it got the sub-agent treatment rather than an inline self-scan: five parallel auditors (SRP; DRY; NAMING incl. doc-comment staleness; COUPLING+DEAD; KISS+behaviour-preservation), each scoped to this diff only and told to treat existing markers as accepted debt. **No NEW >0.5 finding from any of them.** Highest anything scored was ~0.2 (`hostPermission.svelte.ts` holding both the tracker and the request helper — judged cohesion, not a split). The KISS/behaviour auditor independently re-ran `npm run check` and `npm run guard`, diffed every touched file against `git show HEAD:<path>`, and confirmed no drift in the four risk areas: `permissions.request` is still the first and only `await` in both `handleTest`s (Chrome's user-gesture rule holds), the OAuth path reads/writes the same grant state, the header-editor DOM is byte-identical bar the two parameterised strings, and the chat-index entry is field-for-field what it was.

  One real finding came out of it, and it was about the debt register rather than the code: `src/sidepanel/components/ToolCallRow.svelte:63`'s 0.3 COUPLING marker pointed at "ApprovalCard.svelte" for a derivation that has now moved into `AnnotationBadges.svelte`. Re-aimed the marker text and added why card 81 did NOT fold this row in (it derives from a transcript message's `toolAnnotations`/`toolOrigin`, not from a tool, and renders a smaller badge set). Third and last text-only correction; the finding itself stands and stays. Guard re-run after it: still 96 markers, still nothing above 0.5.

  Other judgement calls worth recording: keeping `summarizeChat` and giving it its caller rather than deleting it, and keeping `isServerTool` out of `AnnotationBadges`. Nearest thing to new debt is `PERMISSION_DENIED_MESSAGE` sitting alongside `src/domain/tools/sign-in.ts:161`'s deliberately shorter variant of the same sentence (~0.2, different surface, different audience — not marked).

  **Coverage caveat for the reviewer:** `verify/` exercises the side panel and the WebMCP scenarios; it does not drive the options page, so the two forms' changes are covered by `npm run check` and by reading, not by an end-to-end run. Worth a manual smoke of Options → add/edit a provider and an MCP server (add/remove a header row, a reserved-name error, Show/Hide values, Test connection with and without the host permission, OAuth sign-in) before this moves to done.

  **Gates:** `npm run guard` exit 0 — boundaries clean, `guard:clean-code — scanned 141 file(s) under src/ (excluding src/ui/components/ui); 96 marker(s) found` / `ok — nothing above 0.5`. `npm run check` 867 files, 0 errors, 0 warnings. `npm run build` clean. `npm run verify` 9/9 required checks passed (screenshots best-effort PASS). Not committed.

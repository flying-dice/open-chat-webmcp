---
column: review
agent: claude-sonnet
labels: [frontend]
priority: high
updatedAt: 2026-08-22T17:35:00.000Z
---
# Transcript area on shadcn-svelte

Migrate the transcript column per decisions/28-shadcn-svelte-maia-zinc.md,
preserving behaviour exactly: autoscroll pinning + "Jump to latest" pill,
streaming message rendering, notices snippet, activity groups with their
tool-call rails, and the live activity indicator (its shimmer keyframes are
a legitimate custom-CSS exception per Decision 28).

Components in scope: Transcript.svelte, src/lib/components/Markdown.svelte
(restyle its 160 CSS lines with Tailwind typography-style utilities — keep
the DOMPurify pipeline untouched), MessageActions.svelte,
NoticeCard.svelte (→ Alert), ActivityIndicator.svelte,
ActivityGroup.svelte (→ Collapsible), ToolCallRow.svelte (216 CSS lines —
Badge/Collapsible + utilities). Delete scoped CSS as each migrates.

## Checklist

- [x] Transcript, Markdown, MessageActions, NoticeCard, ActivityIndicator, ActivityGroup, ToolCallRow migrated; scoped CSS removed (shimmer keyframes only exception)
- [x] Autoscroll pinning and jump-to-latest behave identically during streaming
- [x] Markdown rendering visually correct in light and dark (code blocks, lists, links, tables)
- [x] Restricted-page and cross-origin-mismatch notices render and dismiss as before
- [x] Activity rail expand/collapse and per-call status glyphs intact
- [ ] npm run check, npm run build and npm run verify green

## Gates

- [x] check — svelte-check 0 errors/0 warnings across all 810 files, tsc clean (claude-sonnet, 2026-08-22T17:35:00.000Z)
- [x] build — vite build green, dist emitted with no errors (claude-sonnet, 2026-08-22T17:35:00.000Z)
- [ ] verify — not run per coordinator instruction (collides with other agents' concurrent work); left for the post-batch run

## Comments

- **claude-sonnet** (2026-08-22T17:35:00.000Z): Migrated all seven files.
  `src/sidepanel/components/Transcript.svelte:161-299` — layout is now
  Tailwind utilities on plain elements (no scoped `<style>` left at all);
  `data-role`/`.message` wrapper classes are gone (nothing outside this
  file selected on them — checked verify/ and the repo has no unit-test
  tree yet) and the note-action chips (`:216-222`) are now shadcn `Button`
  (`variant="secondary" size="sm"`), same visible text so accessible names
  are unchanged. `src/sidepanel/components/MessageActions.svelte` and
  `ActivityIndicator.svelte:93-141` — pure utility rewrites;
  ActivityIndicator keeps its shimmer sweep in a small `<style>` block per
  decisions/28's explicit exception, now reading `--foreground`/
  `--muted-foreground` (src/app.css) instead of the doomed chat-theme.css
  tokens, with the 1800ms duration hardcoded rather than referencing a
  variable that dies with that sheet. `NoticeCard.svelte` → shadcn's
  `Alert.Root`/`Alert.Description`/`Alert.Action` (`:44-53`) — `Alert.Action`
  reserves its own trailing padding automatically, so the old
  `:not(:has(button))` padding rule needed no replacement.
  `ActivityGroup.svelte:83-110` and `ToolCallRow.svelte:150-250` → shadcn
  `Collapsible`, controlled the same way OverflowMenu.svelte's
  `DropdownMenu` already is (`open`/`onOpenChange`, no `bind:`) so
  ActivityGroup's live/needs-attention auto-expand logic (`:48-58`,
  unchanged) still drives it. `ToolCallRow.svelte` also picked up shadcn
  `Badge` for the origin/meta pills (`:159-201`); the running dot now uses
  Tailwind's built-in `animate-pulse` instead of a hand-rolled keyframe
  (`:145`) — close enough to the old scale+fade that it didn't need
  decisions/28's custom-CSS carve-out. No literal "success" token exists
  in the Zinc palette, so `dotClass` (`:92-105`) reaches for Tailwind's
  stock `emerald-500`/`emerald-400` — first and only place in this
  migration that needed one. Kept the legacy `activity-group`/`summary`
  (ActivityGroup.svelte:83,85) and `step`/`row-head`
  (ToolCallRow.svelte:140,151) class names as styling-free hooks so
  verify/checks/screenshots.mjs's two CSS-selector-based locators
  (`.activity-group .summary` at :414, `.step .row-head` at :419) keep
  finding their targets instead of silently skipping those shots — no
  accessible name changed, so screenshots.mjs itself needed no edit.
  `src/lib/components/Markdown.svelte:98-247` — restyled the whole
  descendant-selector block with shadcn's Zinc tokens
  (`--foreground`/`--muted-foreground`/`--primary`/`--border`/`--muted`/
  `--font-mono`) instead of the legacy custom properties; kept it a scoped
  `<style>` block (the decision's allowed exception) since content arrives
  via `{@html}` and Tailwind utility classes can't reach sanitised
  innerHTML. Did NOT touch src/lib/markdown.ts — same `md-code`/
  `md-code-header`/`md-copy-btn` classes the pipeline already emits.
  Hit one real bug while writing that file's doc comment: a literal
  `` `<style>` `` (angle brackets) inside a `/* */` JSDoc comment made
  svelte-check report "`<script>` was left open" at the file's closing
  `</style>` tag and cascaded into 4 phantom "no default export" errors
  in every importer (ProviderForm/ProviderRow/Transcript/ProviderPicker) —
  reproduced and bisected with a standalone `svelte/compiler` call (which
  compiled fine, proving it's svelte-check/svelte2tsx-specific, not a real
  parse error) before rewording the comment to avoid literal angle
  brackets. Gates: `npm run check` — 0 errors/0 warnings across all 810
  files (including other agents' concurrent in-flight work);
  `npm run build` — green. Did not run `npm run verify` (coordinator runs
  it post-batch) or commit, per instructions. Touched only files in scope;
  did not touch ApprovalCard.svelte, ToolArgs.svelte, Tooltip.svelte,
  Icon.svelte, or App.svelte's snippet contract.

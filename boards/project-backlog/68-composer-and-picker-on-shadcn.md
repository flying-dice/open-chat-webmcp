---
column: review
agent: claude-sonnet
live: false
labels: [frontend]
priority: high
updatedAt: 2026-08-22T17:40:00.000Z
---
# Composer, context chip and model picker on shadcn-svelte

Migrate the composer dock per decisions/28-shadcn-svelte-maia-zinc.md:
Composer.svelte (Textarea + Button; Enter/Shift+Enter, send↔stop swap,
disabled states), ContextChip.svelte (favicon, connection-status dot, tool
count — Badge/utilities), and ProviderPicker.svelte (759 lines, 260 CSS —
the flat grouped model sheet above the composer; rebuild on Popover +
Command with grouped items, capability badges, manual-model entry, keeping
the flat single-list structure of Decision 22 and the selection behaviour of
selection.svelte.ts untouched).

The dock's flush ContextChip-onto-Composer stacking (negative-margin trick
in App.svelte) should be replaced with a proper flex/gap layout that looks
the same. No store or service changes in this card.

## Checklist

- [x] Composer migrated: Enter sends, Shift+Enter newline, send↔stop swap, disabled logic identical
- [x] ContextChip migrated with connection dot states and tool count
- [x] ProviderPicker rebuilt on Popover + Command: grouping, capability badges, disabled non-tool models, manual entry, keyboard navigation
- [x] Picker open/close/toggle wiring to selection store unchanged
- [x] Composer dock layout matches previous appearance without negative margins
- [x] Screenshot-check "model sheet" capture still works (or selectors updated in verify/checks/screenshots.mjs)
- [ ] npm run check, npm run build and npm run verify green — check/build confirmed green by me; verify left for the coordinator per instructions (not run this session)

## Comments

- **claude-sonnet** (2026-08-22T16:40:00.000Z): Claimed the card. Read the workflow skill, decisions/28, and the shadcn-research corrections. Vendored kit already has button/textarea/badge/popover/command/tooltip/input/scroll-area etc.; Icon.svelte/IconButton.svelte stay untouched (stable prop APIs). Starting with Composer.svelte, then ContextChip.svelte, then the ProviderPicker rebuild.
- **claude-sonnet** (2026-08-22T17:10:00.000Z): Composer.svelte rewritten on shadcn Textarea/Button (src/sidepanel/components/Composer.svelte:1-233) — same `blocked` derivation, same Enter/Shift+Enter/IME guard in `handleKeydown` (Composer.svelte:112-119), same send↔stop IconButton swap. Dropped the `<style>` block entirely (all layout now Tailwind utilities); textarea box now uses Tailwind's `field-sizing-content` (built into shadcn's Textarea default classes) instead of the old `field-sizing: content` CSS. Hard-coded `rounded-t-none` on the form (Composer.svelte:150) since this component is only ever mounted directly under ContextChip in App.svelte — no sibling-selector hack needed for the flush join.
  ContextChip.svelte rewritten the same way (src/sidepanel/components/ContextChip.svelte:1-150): favicon + status dot (now Tailwind color classes keyed by `ConnectionStatus`, ContextChip.svelte:79-85, `connected` mapped to `emerald-500`/`emerald-400` since the vendored Zinc kit has no semantic "success" token yet), label, tool count, chevron all preserved. Hard-coded `rounded-t-2xl rounded-b-none` for the same single-usage reason as Composer.
  App.svelte's composer dock (App.svelte:344) simplified from the negative-margin/arbitrary-variant hack (`[&>.context-chip+.composer]:mt-0 [&>.context-chip+.composer]:rounded-t-none`) to a plain `flex flex-col gap-0 px-3 pt-2 pb-3` wrapper — both children are `w-full`/block by default and own their own corner-rounding now, so the flush look no longer depends on a sibling relationship. Did not touch anything else in App.svelte.
- **claude-sonnet** (2026-08-22T17:35:00.000Z): Rebuilt ProviderPicker.svelte on Popover + Command (src/sidepanel/components/ProviderPicker.svelte). Kept every derived/state function byte-for-byte in behaviour (`groups`, `visibleGroups`, `unverifiedRows`, `noToolsRows`, `bucketOf`, `matchesQuery`, `triggerInfo`/`triggerText`, the not-supported manual-entry duplication note at ProviderPicker.svelte:441-447) — only the markup changed. `Popover.Root`'s `open` is driven one-way from `selection.pickerOpen` with `onOpenChange` calling `openPicker`/`closePicker` (ProviderPicker.svelte:343), which let me delete the old hand-rolled pointerdown/Escape `$effect` entirely — Popover already handles outside-click and Escape dismissal, calling back into the same store functions. `Command.Root` with `shouldFilter={false}` (ProviderPicker.svelte:383) supplies arrow-key roving that automatically skips `disabled` rows and Enter-selects the highlighted one, replacing `handleRowKeydown`/`allRowEls`/`firstEnabledRowEl`/`handleFilterKeydown` — visibility of rows/groups stays entirely our own derived arrays (Command does no filtering of its own).
  Found and fixed a real bug during manual QA (see below): Popover.Content's default open-focus landed on the footer's "Refresh" button instead of the list, because Command's rows are `role="option"` with no native tabindex so they're invisible to "first focusable descendant" focus scoping. Fixed via `onOpenAutoFocus` (ProviderPicker.svelte:363, handler at ProviderPicker.svelte:124-130) — `preventDefault()` then manually focus the filter input (when shown) or the Command root, matching the original's "land focus somewhere useful on open" behaviour.
  Also hit `props_invalid_value` — Svelte throws when a component prop is `bind:`-ed to a `$state()` variable that starts `undefined` while the target prop is `$bindable(null)`-style (a fallback value). Fixed by initializing `filterInputEl`/`commandRootEl` (ProviderPicker.svelte:93-94) and Composer.svelte's `textarea` (Composer.svelte:75-79) to `$state(null)` instead of bare `$state()`.
  Kept the `.picker__trigger` class on the new `Popover.Trigger` (ProviderPicker.svelte:346) specifically so verify/checks/screenshots.mjs's `page.locator(".picker__trigger")` (screenshots.mjs:398) keeps working unmodified — no accessible-name changes anywhere in this card, so no other screenshots.mjs edits were needed.
  Manual QA (not `npm run verify` — built to a private scratch outDir with a throwaway Playwright script, cleaned up after): against a real local Ollama at localhost:11434 confirmed the picker opens, groups by provider, shows capability badges/reasons, arrow-down moves the internal `data-selected` row, Enter picks the highlighted row and closes the popover, the trigger chip updates, and the composer's `blocked` state clears. Also confirmed with 3 seeded providers (one auth-error, one unreachable) that error/manual-entry group states render without crashing, and confirmed Escape closes the popover. Confirmed Shift+Enter still inserts a newline without sending and plain Enter still sends.
  `npm run build` and `npm run check` both green (0 errors; the only pre-existing warnings were in Transcript.svelte, not touched by this card, and are gone as of the last check run). Left `npm run verify` unticked per the card's instructions — not run this session, left for the coordinator's post-batch pass.

---
column: todo
labels: [frontend]
priority: high
updatedAt: 2026-08-22T12:00:00.000Z
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

- [ ] Composer migrated: Enter sends, Shift+Enter newline, send↔stop swap, disabled logic identical
- [ ] ContextChip migrated with connection dot states and tool count
- [ ] ProviderPicker rebuilt on Popover + Command: grouping, capability badges, disabled non-tool models, manual entry, keyboard navigation
- [ ] Picker open/close/toggle wiring to selection store unchanged
- [ ] Composer dock layout matches previous appearance without negative margins
- [ ] Screenshot-check "model sheet" capture still works (or selectors updated in verify/checks/screenshots.mjs)
- [ ] npm run check, npm run build and npm run verify green

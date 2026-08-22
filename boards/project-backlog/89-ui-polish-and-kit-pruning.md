---
column: todo
labels: [frontend]
priority: med
updatedAt: 2026-08-23T06:30:00.000Z
---
# UI polish and kit pruning

Close out the cosmetic findings journalled during the UI and clean-code
phases (cards 70, 72, 80):

- **Model sheet** (ProviderPicker): the list clips mid-row at the scroll
  boundary; give the scroll area row-aligned padding, and add a separator
  above the footer row (card 72's visual QA note).
- **History delete tooltip** (card 70's journal): the delete button lost its
  hover tooltip in the migration; restore it with the shadcn Tooltip pattern
  IconButton already uses.
- **Kit pruning** (card 80's removable-kit list): re-verify then remove
  vendored components with zero importers (candidates: dialog, separator,
  skeleton, spinner, switch — check separator isn't an item/kit-internal
  dependency first, and that nothing regenerates them). Also drop the unused
  chart-*/sidebar-* token block from src/app.css if still unreferenced
  (0.3 marker from the audit).
- Re-run the screenshot matrix and eyeball the two fixed spots.

## Checklist

- [ ] Model sheet scroll alignment + footer separator fixed and eyeballed
- [ ] Delete tooltip restored without breaking the accessible name
- [ ] Unused kit components and dead tokens removed after import verification; relevant ≤0.5 markers cleared
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green (screenshots PASS)

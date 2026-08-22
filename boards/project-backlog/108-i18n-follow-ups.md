---
column: todo
labels: [frontend, bug]
priority: med
updatedAt: 2026-08-24T10:30:00.000Z
---
# i18n follow-ups: the protocol string and vendored-kit RTL utilities

Two items journalled by card 105 and left for a clean card:

1. **`{protocol}` renders untranslated** — a param whose VALUE is built in
   code as hardcoded English prose, so nine locales show an English clause
   inside a translated sentence (five translators flagged it
   independently). Find the construction site, turn the value into a
   code/data the UI maps through messages (established pattern:
   src/ui/*Message.ts).
2. **Vendored-kit physical-direction utilities** — card 104 inventoried
   physical `ml-/pl-/left-` usages inside src/ui/components/ui/ (Alert,
   Badge, DropdownMenu, InputGroup, Tabs, Tooltip); under real Arabic they
   are now visible. The kit must stay regenerable: fix via call-site
   overrides where possible; where only a vendored edit works, carry a
   commented local patch per the spinner.svelte precedent and journal it
   for re-application on regeneration. Re-run card 104's
   rtlScreenshots.mjs plus card 105's localeScreenshots.mjs (ar) to prove.

## Checklist

- [ ] {protocol} value localized through a message map; all ten locales render it natively
- [ ] Kit RTL fixes applied (call-site first, journalled patches second); ar screenshots re-eyeballed
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

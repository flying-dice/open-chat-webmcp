---
column: todo
labels: [frontend]
priority: high
updatedAt: 2026-08-23T12:00:00.000Z
---
# Extract all options-page copy to messages

Same treatment as card 101 for src/options/**: section headings and
descriptions, the credential warning, provider/MCP forms (labels, hints,
validation errors, reserved-header messages), test-connection outcomes,
OAuth sign-in states, preset picker, history section incl. the clear-all
dialog, attribution section (the Flaticon licence text stays legally
intact — translate the surrounding copy, keep required attribution wording
per its licence), settings policies. Manifest strings (_locales) get their
en source finalized here too.

## Checklist

- [ ] Zero hardcoded user-facing strings left in src/options/**
- [ ] Validation/test-outcome copy keyed by error codes from the domain vocabularies
- [ ] Attribution licence requirements respected and journalled
- [ ] _locales/en finalized (name, description, action title)
- [ ] Component tests assert via message functions
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

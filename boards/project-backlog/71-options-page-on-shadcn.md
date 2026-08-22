---
column: todo
labels: [frontend]
priority: high
updatedAt: 2026-08-22T12:00:00.000Z
---
# Options page on shadcn-svelte (wholesale)

Migrate the whole options page in one card per
decisions/28-shadcn-svelte-maia-zinc.md: options.css (386 lines of global
classes) is load-bearing for 7 of 11 components that have no scoped styles,
so the page cannot migrate incrementally. Keep the five-section single-page
structure and all flows: ProvidersSection (CRUD, reorder, set-default,
test-connection) with PresetPicker → ProviderForm; SettingsSection (the two
approval policies → RadioGroup or Select + Field); McpServersSection with
McpServerForm (including the OAuth sign-in flow — behaviour untouched);
HistorySection (clear-all with its confirm step → AlertDialog);
AttributionSection (Flaticon licence MUST stay visible).

Map .section→Card, .badge→Badge, .btn-*→Button variants, forms→Field +
Input/Label, .note→Alert, .test-result→Alert variants, .empty-state→Empty,
.preset-grid/.preset-tile→Card grid. Delete options.css entirely at the end.

## Checklist

- [ ] All 11 options components migrated; options.css deleted; no scoped CSS remains except where Decision 28 allows
- [ ] Provider add/edit/delete/reorder/set-default/test flows work end to end
- [ ] MCP server add/edit/delete/test and OAuth sign-in flow work end to end
- [ ] Approval-policy settings persist and reflect current values
- [ ] Clear-all-history confirm uses AlertDialog and still wipes chat:*, tabchat:*, chat:index
- [ ] Attribution section visible; masked API-key field behaviour preserved
- [ ] Light and dark render correctly across all sections
- [ ] npm run check, npm run build and npm run verify green

---
column: todo
labels: [frontend]
priority: high
updatedAt: 2026-08-23T12:00:00.000Z
---
# Extract all side-panel copy to messages

Move every user-facing string in src/sidepanel/** (and src/ui/ shared
components it renders) into messages/en.json with m.key() usages, per
decisions/37-i18n-paraglide.md. Includes: header/menu items, composer
placeholder and states, transcript notices and retry affordances, empty
states, approval card copy, tools/call-log labels, history rows, tooltips,
aria-labels (localized too — they're user-facing), and the error-code →
message maps for provider/storage/tool failures surfaced in the panel
(codes come from the domain vocabularies per decision 34 — no copy remains
in src/domain). Interpolations become typed params; counts use variants.
Key naming: stable, component-scoped, reviewable (e.g. composer_placeholder,
tools_empty_title) — journal the convention.

## Checklist

- [ ] Zero hardcoded user-facing strings left in src/sidepanel/** (grep sweep for literal text in markup; dev-only console/debug strings exempt and journalled)
- [ ] aria-labels and accessible names localized; verify/checks/screenshots.mjs selectors updated to read the same messages (en default keeps captures stable)
- [ ] Error-code→copy maps live UI-side; domain exports codes only
- [ ] Component tests assert via message functions, not string literals
- [ ] npm test, npm run check, npm run guard (incl. guard:i18n), npm run build, npm run verify green

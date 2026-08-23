---
column: todo
labels: [frontend]
priority: med
updatedAt: 2026-08-23T11:30:00.000Z
---
# Storybook: options coverage

Colocated stories for every non-vendored src/options component per
decisions/42: sections (providers with rows/badges/test outcomes, MCP with
OAuth states, settings policies, history incl. the clear-all dialog,
attribution), forms (ProviderForm masked-key/headers/validation-error
states, McpServerForm auth modes + the extracted McpOAuthPanel states),
PresetPicker, RegistryRow, HeadersEditor (reserved-name error),
McpTestResult (ok/error/tool-list disclosure). Reuse the options
fake-services/fixtures; empty guard:stories' allowlist to zero and flip
the guard to no-allowlist mode so future components require stories.

## Checklist

- [ ] Every options component has stories; form error/edge states covered
- [ ] guard:stories allowlist emptied and strict mode on
- [ ] npm test, npm run check, npm run guard, npm run build, build-storybook green

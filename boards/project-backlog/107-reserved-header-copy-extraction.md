---
column: todo
labels: [frontend, backend]
priority: high
updatedAt: 2026-08-24T05:50:00.000Z
---
# Extract the last two domain strings: reserved-header errors

Card 103's journal flagged the final user-facing strings living outside
messages/en.json: the reserved-header validation errors at
src/domain/providers/provider.ts:111,114 (`reservedHeaderReason`) and
src/domain/tools/servers.ts:128 (`validateServerHeaders`) — they reach the
options forms, disagree with each other on contractions and quote style,
and would ship untranslated in every locale. Apply the established
code/copy split (src/ui/providerMessage.ts pattern): the domain returns a
reserved-header code (with the header name as data), a shared UI module
maps it to messages, both forms' error paths render through it. Mind the
smoke-locator blast radius card 103 warned about: optionsSmoke.mjs matches
"Content-Type is set automatically" — update its locator to the new
message. Also fix the 12px code-class nit from the same journal: the
`<code class="font-mono text-xs">` inside the two rich-copy strings should
be the 13px `text-code` role per decisions/36.

## Checklist

- [ ] Domain returns reserved-header codes; copy lives in messages/en.json via a shared UI map; both forms migrated; glossary/quote style consistent with card 103
- [ ] optionsSmoke.mjs locators updated and re-run 13/13
- [ ] Rich-copy code spans on text-code per decisions/36
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

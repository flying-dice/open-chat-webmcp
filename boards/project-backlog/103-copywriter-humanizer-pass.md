---
column: todo
labels: [frontend, docs]
priority: high
updatedAt: 2026-08-23T12:00:00.000Z
---
# Copywriter pass: humanize the English source

With all copy in messages/en.json (cards 101-102), a dedicated copywriter
persona reviews every string BEFORE translation (decisions/37): reads well
aloud, plain and human, consistent voice and terminology (one name per
concept: chat/provider/model/tool/server — build the glossary), sentence
case per the design language, no AI-isms (seamlessly, leverage, empower,
robust, "Let's", reflexive em-dashes, apology boilerplate), no
over-explaining. Error messages say what happened and what to do next, in
that order, without blame. The type-scale rule from decisions/36 applies to
copy too: titles are noun phrases; sentences live in descriptions.
Also covers _locales/en manifest strings and the README's user-facing
front section.

## Checklist

- [ ] Every messages/en.json string reviewed; edits applied with the glossary journalled
- [ ] Titles are noun phrases; error copy follows what-happened → what-next
- [ ] AI-ism sweep documented (patterns checked, instances fixed)
- [ ] Component tests still green (they assert via message functions, so copy edits flow through)
- [ ] Screenshots re-captured where copy changed; verify selectors intact
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

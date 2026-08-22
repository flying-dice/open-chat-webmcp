---
column: todo
labels: [frontend, docs]
priority: med
updatedAt: 2026-08-23T12:00:00.000Z
---
# Add the top languages and close the i18n phase

Translate the humanized English source (card 103) into the nine locales
from decisions/37 — zh-CN, ja, de, fr, es, pt-BR, ko, ru, ar — for both
messages/{locale}.json and _locales/{locale}/messages.json (Chrome
underscore naming: pt_BR, zh_CN). Translations follow the card-103
glossary; technical terms (WebMCP, MCP, OAuth, API key) stay untranslated
where convention dictates; variants/plurals localized properly per
language, not copied. Pin pt-BR tag casing (known Paraglide fallback bug
history) and test its fallback. guard:i18n proves completeness both ways
for every locale. Spot-check screenshots for ar (RTL, from card 104's
groundwork) and one CJK locale (zh-CN) for layout overflow at 320px.
Mark translations as machine-produced pending native review in the docs.

## Checklist

- [ ] Nine locales complete in messages/ and _locales/; guard:i18n green
- [ ] Glossary consistency spot-audited across locales; plural variants localized
- [ ] ar and zh-CN screenshot spot-checks at 320/400px journalled; overflow fixed
- [ ] Language picker lists all locales with native names; switching verified
- [ ] docs updated (i18n section: how to add a string, how to add a locale, native-review status); version bumped to 0.4.0
- [ ] Full release gate: npm test, npm run check, npm run guard, npm run build, npm run verify green

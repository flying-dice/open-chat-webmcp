---
column: backlog
labels: [infra, docs]
priority: low
updatedAt: 2026-08-24T11:00:00.000Z
---
# Chrome Web Store packaging (backlog)

Not in the current sprint — filed so it stops being folklore (card 86's
release judgment noted the extension has never been made shippable). When
picked up: a `npm run package` producing a store-ready zip from a clean
build; listing copy sourced from the humanized _locales strings; privacy
disclosure derived from docs/03-privacy-and-trust.md; icon/asset audit;
MV3 review checklist (permissions justification — note the WebMCP flag
dependency through Chrome 156 constrains a public listing anyway).

## Checklist

- [ ] Package script + clean-build zip
- [ ] Listing copy + privacy disclosure drafted from existing sources
- [ ] Review-readiness checklist journalled with the Chrome-156 caveat

---
column: todo
labels: [infra, frontend]
priority: high
updatedAt: 2026-08-23T12:00:00.000Z
---
# Paraglide i18n toolchain and guards

Stand up i18n per decisions/37-i18n-paraglide.md. Verified setup facts and
gotchas are in the research note — READ IT FIRST:
`/private/tmp/claude-501/-Users-jonathanturnock-Projects-ollama-webmcp-chrome/81c762bd-d84f-407b-b12d-2f806b3f03d9/scratchpad/i18n-research.md`
(Paraglide 2.x config for plain Vite + CRXJS, the missing-key gap that our
guard closes, localStorage-vs-chrome.storage strategy verification, the
reload-on-switch default, _locales mechanics, pt-BR casing pitfall).

No copy extraction in this card — prove the pipeline with a handful of
strings (e.g. the options page header) end to end.

## Checklist

- [ ] Paraglide installed: project.inlang, messages/en.json, vite plugin with emitTsDeclarations, codegen in postinstall so check/tsc always see generated messages; m.key() proven typed (planted unknown key fails check)
- [ ] `npm run guard:i18n` (scripts/i18n-completeness.mjs): key-set diff of every locale vs en — missing OR orphan keys fail with file+key output; wired into npm run guard; proven with a planted violation
- [ ] Locale strategy configured; verified whether sidepanel+options share localStorage (same origin) — if not, custom chrome.storage strategy; language picker added to options Settings (uses default reload-on-switch)
- [ ] lang/dir bootstrap module run before mount on both surfaces (RTL set: ar)
- [ ] _locales/en/messages.json scaffold + manifest default_locale + __MSG_extName__/__MSG_extDescription__ wired via manifest.config.ts; build verified to produce a loadable extension
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

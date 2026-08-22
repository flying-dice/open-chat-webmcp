---
name: pre-commit
description: Use before every git push — mandatory quality gate, no exceptions
---

Before push. No exceptions.

1. **Run `change-review`** on the outgoing change — correctness, unhappy paths, tests. Any `bug`/`issue` → blocked. Fix it.
2. **Run `clean-code-review`** on the same change — SRP/DRY/naming/coupling/dead-code/KISS. It tags violations as `// TODO: clean-code - <score> - <CAT>: …` markers.
3. **Run `npm run guard`** — six gates, all blocking, none of them eyeballable. Run the script.
   - `guard:biome` — `biome ci --error-on-warnings` (decisions/35). Lint AND formatting; a formatting diff fails the gate, so run `npm run format` before you push. The vendored `src/ui/components/ui/` and `src/ui/utils.ts` are lint-excluded, everything else is not.
   - `guard:boundaries` — dependency-cruiser plus `scripts/guard-boundaries.mjs`; fails any import that breaks the DDD-hexagonal layering, and any `chrome.*` reached for outside an adapter or a composition root (decisions/29, card 78).
   - `guard:clean-code` — scans for `TODO: clean-code -` markers in both `//` and `<!-- -->` forms; score **> 0.5** → blocked (fix it, or run `refactor` to clear the highest-scored one at a time) (decisions/31).
   - `guard:return-types` — every exported function under `src/` declares its return type (decisions/35). Ports and interfaces never rely on inference.
   - `guard:throws` — every `throw`/`Promise.reject` under `src/` is on `scripts/throw-allowlist.json` with a named invariant, and `throw` means a bug (decisions/34). A new expected failure is a `Result` in the signature, not an allowlist entry.
   - `guard:i18n` — every locale under `messages/` carries exactly the base locale's key set, with the same message/variant structure (decisions/37). Paraglide's compiler catches an unknown key at a CALL SITE; a locale missing a key falls back to English silently, and this is the only thing that sees it.
4. `npm run check`, `npm run build`, and tests (`npm test`; `npm run verify` if an end-to-end flow changed) after every fix.
5. Re-run from step 1. Repeat until `change-review` is clean **and** `npm run guard` is green.

Only then push.

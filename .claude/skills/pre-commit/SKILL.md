---
name: pre-commit
description: Use before every git push — mandatory quality gate, no exceptions
---

Before push. No exceptions.

1. **Run `change-review`** on the outgoing change — correctness, unhappy paths, tests. Any `bug`/`issue` → blocked. Fix it.
2. **Run `clean-code-review`** on the same change — SRP/DRY/naming/coupling/dead-code/KISS. It tags violations as `// TODO: clean-code - <score> - <CAT>: …` markers.
3. **Run `npm run guard`** (decisions/31): `guard:clean-code` scans for `TODO: clean-code -` markers in both `//` and `<!-- -->` forms — score **> 0.5** → blocked (fix it, or run `refactor` to clear the highest-scored one at a time); `guard:boundaries` fails any import that breaks the DDD-hexagonal layering (decisions/29). Don't eyeball either — run the script.
4. `npm run check`, `npm run build`, and tests (`npm test`; `npm run verify` if an end-to-end flow changed) after every fix.
5. Re-run from step 1. Repeat until `change-review` is clean **and** `npm run guard` is green.

Only then push.

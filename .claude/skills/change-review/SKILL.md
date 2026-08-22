---
name: change-review
description: Review a set of changes (the staged diff, or a branch's diff) for correctness — before committing, pushing, or as a standalone pass
---

Review the change on its own merits. No session context assumed — the diff has to stand by itself.

## Process

1. **See exactly what changed** — the staged diff (`git diff --staged`), or a branch diff (`git diff <base>...HEAD`), plus `git status` for new files the change depends on. Review only what's in the change set.
2. Read the diff in context — what changed, why. Open the surrounding code the hunks touch; a hunk that reads fine alone can still break its caller. For Svelte components, check both sides of the props/events contract.
3. **Run the checks the change touches** — `npm run check` (svelte-check + tsc), `npm run build`, and the relevant tests for the affected area (`npm test` for unit/component suites; `npm run verify` when the change touches an end-to-end flow the harness covers). Scope to what the diff affects; don't rebuild the world. If a pipeline already ran these for this exact revision, trust its result — don't re-run.
4. Devise unhappy-path scenarios (given/when/then) and run the ones the tests don't cover. A failed scenario → a full given/when/then in the finding so the author can turn it into a test.
5. **Test gap** — behaviour added with no test is a finding (`issue`), not a pass.
6. Report findings (format below). `bug`/`issue` **block**; `nit`/`question` don't.

## Checklist

Pass, fail, or `N/A — <reason>`. No blanks.

- [ ] `npm run check` + build + affected tests pass (run, or confirmed green in a pipeline — not assumed)
- [ ] New behaviour has tests
- [ ] Destructive/edge-case paths considered (storage writes, message races between surfaces, aborted streams)
- [ ] No silent reverts
- [ ] No unrelated changes, no debug/WIP leftovers (stray `console.log`, `debugger`, `$inspect`, `.only`/`.skip` on tests, commented-out code)
- [ ] Change does what its message/intent says

## Comment format

```
**[type]** summary

detail
```

- `bug` — breaks at runtime. Blocks.
- `issue` — wrong but won't crash (missing test, edge case, leak). Blocks.
- `nit` — non-blocking.
- `question` — answer before proceeding.

## Focus

Weight unhappy paths. The happy path probably works — the author just wrote it. Find where it falls apart: regressions, edge cases, error paths, message races between the background worker / side panel / content script, stale chrome.storage reads, aborted fetch streams, interface changes that break the other side of the protocol, silent reverts, debug/WIP code sneaking in.

## Ignore

Style a formatter/linter already enforces. "I'd do it differently." Re-running a check a pipeline already passed for this revision. Anything outside the change under review.

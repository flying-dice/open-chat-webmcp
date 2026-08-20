---
column: review
labels: [bug, frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-20T23:00:00.000Z
---
# Transcript crashes on a duplicate activity-group key

A real session using GitHub's MCP server (heavy tool use) crashed the whole
side panel: `Uncaught Error: https://svelte.dev/e/each_key_duplicate`,
reported by the user with a minified production stack trace.

Decoded the trace against a sourcemapped rebuild (`@jridgewell/trace-mapping`,
already a transitive dependency — no new dependency added) rather than
guessing: it resolved to `src/sidepanel/components/Transcript.svelte:169`,
`{#each groups as group (group.key)}`. `groups` comes from
`src/sidepanel/lib/transcriptGroups.ts`'s `groupTranscript`, and an activity
group's key is `` `act:${message.id}` `` — the id of that group's FIRST tool
step. Two activity groups sharing that key means two different points in the
transcript had a tool-step message with the SAME `id`.

## Immediate fix (this card, done)

`Transcript.svelte:169` now keys the `{#each}` by array index instead of
`group.key`. Safe for this structure: `groupTranscript` re-derives the whole
`groups` array from the (append-only, per its own doc comment) `messages`
array on every call, so an existing group's POSITION never shifts as later
messages stream in — the same component-identity stability the original
`group.key` choice existed to protect (see transcriptGroups.ts's comment
about not deriving a key from `steps.length`) stays intact; it just can no
longer crash on a collision.

Verified by reproducing the exact shape via a real driven side-panel render:
seeded a chat with two separate activity groups whose first tool step shares
one `id` (`dup-1`) — crashed pre-fix (by inspection: `group.key` for both
would be `act:dup-1`), renders both groups cleanly post-fix. `npm run check`,
`npm run build`, `npm run verify` (9/9) all clean.

## Real question, NOT investigated here: why did two messages share an id?

`message.id` is `crypto.randomUUID()` (panel.svelte.ts's `makeId`) — random
collision is not a plausible explanation. The far more likely explanation is
that the SAME message object ended up in `session.messages` twice, or a
message was regenerated with a reused id, somewhere in the tab-sync /
session-restore machinery — territory already covered by several currently
open cards (54, 55, 57, 58, 59) about tab switching, chat restore, and turn
ownership. This card does not attempt that investigation; it exists so the
crash stops being fatal while that's figured out. Whoever picks up 54/55/57/58/59
should know a duplicate-message-id symptom has been directly observed in
production, not just theorized.

## Checklist

- [x] Decode the real crash location from the minified stack (sourcemapped rebuild, not guessed)
- [x] Stop the crash: index-keyed `{#each}` in Transcript.svelte
- [x] Reproduce the exact duplicate-key shape and confirm the fix holds
- [ ] Root-cause why a tool-step message id repeats — left for whoever works 54/55/57/58/59

## Gates

- [x] check — npm run check: 176 files, 0 errors (claude, 2026-08-20T23:00:00.000Z)
- [x] build — npm run build green (claude, 2026-08-20T23:00:00.000Z)
- [x] verify — npm run verify: 9/9 required checks passed (claude, 2026-08-20T23:00:00.000Z)

## Comments

- **claude** (2026-08-20T23:00:00.000Z): User reported a full page crash with only a minified production stack trace (no component name, no sourcemap in the shipped build). Built once with `vite build --sourcemap` into a throwaway `dist-verify`-style directory (deleted after) and decoded every frame with `@jridgewell/trace-mapping` (already present transitively, nothing added to package.json) rather than guessing which `{#each}` was at fault — confirmed both reported stack traces bottomed out in Svelte's own each-block reconciliation internals, with the one frame outside the shared runtime chunk resolving to `src/sidepanel/components/Transcript.svelte:169` and `src/sidepanel/App.svelte:310`. Fixed the `{#each}` key (Transcript.svelte:169, now keyed by index — see module comment there for why that's safe for this specific append-only structure), reproduced the exact collision shape (two activity groups whose first tool-call message shares an `id`) via a real Playwright-driven side-panel render seeded directly into `chrome.storage`, confirmed clean before/after. Flagged, not chased, the deeper question of why a message id repeated at all — that's squarely in the territory cards 54/55/57/58/59 already own.

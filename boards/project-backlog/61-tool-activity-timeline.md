---
column: review
labels: [frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-20T13:00:00.000Z
---
# Compact tool-activity timeline and a live status line

Every tool call is currently a full-width filled card; three of them push the
reply off a 320px panel. Replace them with a Claude-Code-style timeline of
one-line steps that collapses to a single summary row once the reply lands, and
replace the 2px blinking cursor with a ChatGPT-style shimmering status line that
says what the turn is actually doing.

Drill-down stays two levels: group → step → payload. Depends on card 60's
`TurnPhase`. See decisions/26-transcript-activity-groups-and-turn-phase.md.

## Checklist

- [x] `src/sidepanel/lib/transcriptGroups.ts`: pure `groupTranscript(messages)`
      → `user` | `prose` | `activity` groups. An empty assistant carrier is
      dropped from display and does NOT close an open activity group; the group
      key is `act:<first step id>` and never changes as steps append
- [x] `summariseActivity(steps)` in the same file — count, ≤2 names then `+N`,
      server names, error/denied/approved counts, `needsAttention`
- [x] `--duration-shimmer` / `--duration-pulse` tokens in `chat-theme.css`
- [x] `ActivityIndicator.svelte`: glyph + shimmering sentence + elapsed past 1s;
      `aria-live` on the sentence only; `prefers-reduced-motion` fallback
- [x] `ToolCallRow.svelte`: one-line head (dot, mono name, origin, duration,
      chevron), meta badges, inline error line, payload with `ToolArgs` and the
      Result block lifted verbatim from `ToolCallCard.svelte:88-98, 216-241`
- [x] `ActivityGroup.svelte`: summary button + rail; expanded while live or on
      error/denied; a user toggle pins it for the component's lifetime
- [x] `Transcript.svelte` renders groups; `.cursor` and `@keyframes blink`
      deleted; `ApprovalCard` loop unchanged and still last
- [x] Autoscroll `$effect` still reduces over the flat `messages` prop (+
      `turnPhase?.kind`); expansion state stays out of that dependency
- [x] `ToolCallCard.svelte` deleted
- [x] `panel.isStreaming` now has ZERO call sites (card 60 moved them all to
      `isTurnActive`; `Transcript` gates `MessageActions` on `streamingMessageId`).
      Either give it a real consumer or delete the getter — do not leave dead API
- [x] `verify/checks/screenshots.mjs`: seed a chat with a full tool sequence
      (incl. an empty carrier, an untrusted result, a denied and an error call)
      and a second clean all-success chat; shoot collapsed / expanded / payload
- [x] `npm run check` + `npm run build` green; options CSS chunk hash unchanged
- [ ] Manual matrix via `npm run launch` against demo/ (live phases can only be
      verified by hand — the harness has no streaming provider) — DELIBERATELY
      LEFT for the overseeing session per this card's own instructions (never
      run `npm run launch` from an agent — it opens the user's real Chrome)

## Gates

- [x] npm-check — svelte-check 175 files / 0 errors / 0 warnings (baseline
      was 172; +4 new files, -1 deleted = net +3, no regressions) (claude-sonnet, 2026-08-20T13:00:00.000Z)
- [x] npm-build — `vite build` succeeded; options CSS chunk stayed
      `index-CNrU0DrI.css` (unchanged hash), confirming chat-theme.css
      changes never leaked into the options bundle (claude-sonnet, 2026-08-20T13:00:00.000Z)
- [x] npm-verify — 9/9 required checks passed; best-effort screenshot check
      passed and wrote 9 files including the 3 new activity shots
      (claude-sonnet, 2026-08-20T13:00:00.000Z)

## Comments

- **claude-sonnet** (2026-08-20T13:00:00.000Z): Implemented card 61 end to end.

  **New files:**
  - `src/sidepanel/lib/transcriptGroups.ts` — pure `groupTranscript(messages)`
    (folds the flat `PanelMessage[]` into `user`/`prose`/`activity` display
    groups, never mutating the underlying array `runLoop` replays to the
    provider) and `summariseActivity(steps)` (count/names/server-names/
    error·denied·approved counts/`needsAttention`).
  - `src/sidepanel/components/ActivityIndicator.svelte` — the tail live line:
    sparkle/build glyph, shimmering sentence (`aria-live="polite"`), elapsed
    counter past 1s owned by a `setInterval` inside an `$effect` keyed on
    `phase.startedAt`. Narrowed its own `phase` prop to
    `Extract<TurnPhase, {kind:"waiting"}|{kind:"calling"}>` (`:32`) rather than
    the full `TurnPhase` union — `svelte-check` correctly refused to let
    `phase.origin`/`phase.toolName` be read against a union that still
    included `streaming`, since only Transcript's runtime filtering (not the
    type system) guarantees this component is never mounted for it.
  - `src/sidepanel/components/ToolCallRow.svelte` — one compact timeline step:
    status dot, mono tool name, always-visible origin (page/server-badge/
    "origin unknown", never defaulted), duration (looked up in
    `panel.toolCalls` by id, `formatDuration`), meta badges, an inline
    `.step-error` line for error/denied that's never behind the payload
    toggle, and a default-closed payload. The Result block, `data-untrusted`,
    the dashed-border rule, and the untrusted-note comment are lifted
    verbatim from the old `ToolCallCard.svelte:88-98,216-241` (`:190-206`,
    `:333-353`) — the one part of that file with a security meaning
    (decisions/17), carried across rather than re-derived. Added one thing
    the old card never had: `message.toolMcpAnnotations?.title`, shown ONLY
    inside the payload, attributed `The server calls this: "…"` (`:198-202`)
    — never the row's label, since it's attacker-influenceable text
    (decisions/19 §2).
  - `src/sidepanel/components/ActivityGroup.svelte` — summary button + `<ol
    class="timeline">` rail of `ToolCallRow`s. Expansion is
    `userToggled ? userExpanded : (live || summary.needsAttention)` — no
    `$effect`, and deliberately NOT `ToolCallCard.svelte`'s old
    `untrack(() => …)`-once pattern, since a group's default (live→done)
    genuinely changes over its lifetime where a call's approval mode never
    did (see the component's own doc comment, `:12-24`, for the full
    reasoning). Collapsed summary line never hides a remote server call or
    an approve/deny outcome (decisions/05, decisions/19 §6).

  **Edited:**
  - `src/sidepanel/chat-theme.css:36-43` — added `--duration-shimmer: 1800ms`
    / `--duration-pulse: 1200ms` in a new "Motion" section.
  - `src/sidepanel/components/Transcript.svelte` — added `turnPhase` prop
    (`:47-49`), derived `groups`/`tailPhase`/`liveGroupKey` (`:92-102`),
    replaced the flat `{#each messages}` loop with a `{#each groups}` one
    (`:165-215`) rendering `ActivityGroup` for activity groups and
    `ActivityIndicator` after the `ApprovalCard` loop (`:223-227`), deleted
    `.cursor`/`@keyframes blink`, and hardened `lastAssistantId` to skip
    empty carriers (`:80-90`). The autoscroll `$effect` (`:139-145`) still
    reduces over the flat `messages` prop (per spec — `updateToolCallResult`
    mutates messages still in that array) with `turnPhase?.kind` added as a
    dependency; group/row expansion state was never wired into it, with a
    comment (`:135-138`) explaining why that has to stay true.
  - `src/sidepanel/App.svelte` — passes `turnPhase={panel.turnPhase}` to
    `Transcript` (near the existing `Transcript` call).
  - `src/sidepanel/stores/panel.svelte.ts` — deleted the `isStreaming`
    getter (confirmed zero real call sites beyond its own doc comments and
    one historical note in Composer.svelte describing what it USED to feed;
    card 60 had already moved every real consumer to `isTurnActive`) and
    updated the three doc comments that referenced it (`:91-95`, `:386`,
    `:490-506`) so none of them point at deleted API.
  - Fixed five other components' doc comments that named `ToolCallCard.svelte`
    by name as a live cross-reference (not history) — `ToolArgs.svelte`,
    `CallLogEntry.svelte` (×2, including correcting a comment that would have
    inaccurately claimed `ToolCallRow` auto-expands its payload for
    approved/denied calls — it doesn't; only the call log itself keeps that
    rule now, and the group-level auto-expand is what carries it in the
    transcript), `ToolListItem.svelte` (×2), `agentLoop.ts:219`.
  - `verify/checks/screenshots.mjs` — chat 0 (`seed-0`) now seeds the full
    tool sequence from the spec: user → prose → empty `toolCalls`-only
    carrier → auto/read-only success → untrusted-content success from a
    server tool (`Docs Server`) → denied → error on a hallucinated tool name
    (`origin unknown`), plus matching `session.toolCalls` log entries with
    `startedAt`/`endedAt` so durations render. Chat 1 (`seed-1`) is a new
    clean all-success run so the COLLAPSED default has a shot too. Added
    `sidepanel-dark-activity-expanded`/`-payload`/`-collapsed` shots
    following the file's existing locate→count()→click→wait→shoot pattern;
    reaching chat 1 goes through the overflow menu's actual recent-chats
    list (matched by the chat's own displayed title, not a row index — the
    menu's first `role="menuitem"` turned out to be a connection-status row
    above "Recent chats", so an index-based click silently clicked the WRONG
    row on the first attempt and produced an identical-looking "collapsed"
    shot; caught by comparing rendered pixels, not by any type/lint gate).

  **Deleted:** `src/sidepanel/components/ToolCallCard.svelte`.

  **Deviations from the spec:** none of substance. One HTML nesting issue
  self-corrected during writing: added `data-status={displayStatus}` to
  ToolCallRow's `.result-section` wrapper (`ToolCallRow.svelte:210`) so the
  error/denied "the content itself turns danger-red" rule from the old card
  (`.tool-card[data-status="error"] .tool-content{color:danger}`) had
  somewhere to attach now that there's no longer one wrapping element per
  row carrying `data-status` — the spec's verbatim-lift instruction didn't
  call this rule out explicitly but it's part of the same visual contract.

  **Gates:** `npm run check` — 175 files / 0 errors (was 172, +3 net files,
  no regressions). `npm run build` — succeeded; the options page's CSS chunk
  hash (`index-CNrU0DrI.css`) is unchanged from a pre-card-61 build,
  confirming `chat-theme.css`'s changes stayed isolated to the sidepanel
  bundle per decisions/18. `npm run verify` — 9/9 required checks passed;
  the best-effort screenshot check passed and wrote all 9 files (the
  existing 6 plus the 3 new activity ones) to
  `verify/output/screenshots/`. Chrome for Testing launched fine in this
  environment.

  **Left for the overseeing session:** the manual matrix via `npm run
  launch` (per this card's own instructions, never run from an agent — it
  opens the user's real Chrome) — this is also the ONLY way to see the LIVE
  phases (the shimmer, the pulsing dot, the elapsed counter ticking) since
  the verify harness has no streaming provider and can only ever capture
  static, already-settled states.

  **Out-of-scope observation, not fixed (per this card's scope discipline):**
  the `sidepanel-dark-menu` screenshot's recent-chats list shows a 7th,
  unlabelled entry titled by its own origin, `chrome-extension://<id>` — an
  empty chat with no messages, created by the harness's own first,
  pre-seed navigation (see `screenshots.mjs`'s existing header comment:
  "navigate once to get an extension-origin context, write, then reload
  into a seeded world" — that first navigation genuinely mounts the app
  against a not-yet-seeded `tabchat:1`, so `getOrCreateChatForTab` creates a
  real chat, and its own commit can race the seed write and land a stray
  index entry back in afterward). This predates card 61 — nothing in
  `seedData()`'s existing structure or this card's additions causes it, and
  it doesn't affect any of the new activity shots (the exact-title match
  used to reach chat 1 was written to be robust to it, and was in fact
  discovered because of it).
- **claude** (2026-08-20T18:55:00.000Z): Oversight verification, independent of the implementing agent's own report. Re-ran both gates myself: `npm run check` → 175 files / 0 errors, `npm run build` → clean, and the options entry still links `assets/index-CNrU0DrI.css`, untouched by this card (git status confirms no `src/options/**` file is in its change set), so decisions/18's panel-vs-options CSS isolation held. Audited the four load-bearing pieces against decisions/26 rather than trusting the summary: the activity key is fixed to the first step's id at src/sidepanel/lib/transcriptGroups.ts:66-70 (no remount-on-append, so a mid-turn toggle survives); the empty-carrier drop does not close an open group at src/sidepanel/lib/transcriptGroups.ts:53-58; the expand machine is the reactive-default/sticky-override pattern with no `$effect` at src/sidepanel/components/ActivityGroup.svelte:39-49; and the autoscroll effect still reduces over the flat `messages` prop with expansion state deliberately excluded at src/sidepanel/components/Transcript.svelte:134-146. Security markup survived the compaction intact — `data-untrusted` and the dashed `--color-danger` result border at src/sidepanel/components/ToolCallRow.svelte:171,388-390, and `toolMcpAnnotations.title` is payload-only and attributed at src/sidepanel/components/ToolCallRow.svelte:155-158, never the row label. Eyeballed three screenshots: `sidepanel-dark-activity-collapsed.png` shows the whole point of the card — two tool calls reduced to one quiet row between the prose; `-payload.png` shows the rail, dots, `this page`/`Docs Server` origins, durations and an open Arguments/Result; `sidepanel-light-320w.png` shows the error/denied rows at the tightest width with names ellipsised and no horizontal overflow. One fixture nit for whoever touches this next, not worth a re-run: `sidepanel-dark-activity-expanded.png` is byte-identical to `sidepanel-dark-400w.png`, because chat 0 carries an error and a denial and so is auto-expanded by design already — the shot is honest about what it shows but adds nothing over the default view. Did not re-run `npm run verify` (the implementing agent's run wrote all 9 screenshots at 18:49) and did not run `npm run launch` — the live phases (shimmer, pulsing dot, elapsed counter) still have no automated coverage and remain hand-verification only.

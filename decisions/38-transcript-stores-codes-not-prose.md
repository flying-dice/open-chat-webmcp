---
status: Accepted
date: 2026-08-24
---
# Decision 38 — Persisted transcripts store codes, not prose

## Context

The i18n phase moved every rendered string into messages — except the ones
the turn engine writes INTO the transcript as it runs: assistant notes
(terminal errors, retry affordances), fenced untrusted-content labels, and
tool-call status texts are composed as English prose in src/domain/chat and
persisted inside ChatSession. Cards 101/103/105 all flagged this as
larger-scope debt: a chat recorded today renders English fragments forever,
in every locale, and the copywriter can never improve shipped history.

## Decision

Transcript entries persist structured data — a note KIND plus its params
(error code, tool name, action affordances) — and the UI renders them
through messages at display time, the same code/copy split every other
error already uses (decision 37). The turn engine composes no prose.
Pre-release rules apply (no migration): stored chats with prose notes are
simply rendered as-is via a legacy passthrough or discarded with the rest
of the disposable data; the write path changes, nothing is converted.

## Consequences

- Old chats' embedded English may render unchanged or disappear on
  eviction — accepted, per the pre-release data posture.
- The transcript fixture set and screenshot seeds move to the new shape.
- Locale switching retroactively localizes history — notes re-render in
  the new language, which is the correct behaviour users expect.

---
status: Superseded
date: 2026-08-19
---
# Decision 05 — Approval policy is derived from `annotations.readOnlyHint`

> **Superseded by [decisions/17](17-spec-annotations-and-untrusted-content.md).**
> The `readOnlyHint` rule below survives unchanged; `destructiveHint` does not
> exist in the WebMCP IDL and is silently dropped by Chrome, and
> `untrustedContentHint` handling has been added. Kept for history.

## Context

Once a model can call page tools, it can act on the user's behalf on a live,
logged-in site — clicking, filling, submitting, deleting. Confirming every call
makes multi-step chats unusable; confirming nothing means a small local model can
mutate a real account off a hallucinated argument.

WebMCP tool descriptors carry optional `annotations`, including `readOnlyHint`
(the tool does not modify state) and `destructiveHint`.

## Decision

Default policy, per call:

- `annotations.readOnlyHint === true` → **run automatically**, rendered as a
  collapsed tool card in the transcript.
- anything else, **including tools with no annotations at all** → **require
  explicit approval** via an inline approve/deny card in the chat. Absence of a
  hint is treated as mutating, never as safe.

Denying returns a tool result of "user denied this call" to the model so the
conversation continues coherently instead of stalling.

The user can override the default globally in options — *always confirm* or
*auto-run everything* — and can approve a specific tool for the rest of the
session ("don't ask again for this tool on this page").

## Consequences

- The common read-heavy case (the model reading page state to answer a question)
  stays fluid; the dangerous case always stops for a human.
- Annotations are supplied by the page and are not trustworthy in a security
  sense — a hostile page can label a destructive tool read-only. This policy is
  UX guidance, not a security boundary. The real boundary is that the user chose
  to open the panel on that site.
- The agent loop must be able to suspend mid-iteration awaiting a UI decision, so
  approval is modelled as a promise the tool-call step awaits.
- Every call, approved or auto-run, is recorded in the inspector log
  ([decisions/07](07-session-state-and-persistence.md)) so nothing happens
  invisibly.

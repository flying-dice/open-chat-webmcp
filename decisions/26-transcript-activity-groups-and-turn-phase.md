---
status: Proposed
date: 2026-08-20
---
# Transcript activity groups and an explicit turn phase

## Context

The side panel renders one filled `--color-surface-container` card per tool call
(`ToolCallCard.svelte`) and a 2px blinking bar as its only progress indicator
(`Transcript.svelte`'s `@keyframes blink`). At a 320–400px panel width, three
tool calls push the reply off screen, and the blinking bar says nothing about
what is happening.

Worse, the bar is attached to the *streaming* assistant message, and
`runLoop` closes that message (`endAssistantMessage`) **before** it executes any
tool calls. So `panel.isStreaming` is false for the entire tool round: during the
one part of a turn a user most wants feedback, there is none at all. The same
gap silently removed the composer's Stop button, which was also gated on
`isStreaming`.

Each loop iteration also pushes an assistant message with `content: ""` purely to
carry that round's `toolCalls`. It renders as a bare sparkle + model-name header
with nothing under it, once per round.

The reference behaviours we want to converge on: Claude Code's timeline of tool
steps that collapses once the reply is in place, and ChatGPT's shimmering
"working" line that expands into thinking and tool detail.

## Decision

Two mechanisms, deliberately separate.

**1. Display grouping — derived, never stored.**
A pure `groupTranscript(messages)` folds the flat `PanelMessage[]` into user
turns, prose turns, and *activity groups* (a run of consecutive `role:"tool"`
messages). An empty assistant carrier is dropped **from display** but does not
close an open activity group, so the several tool rounds of one turn read as one
timeline — unless the model narrates between rounds, in which case that prose
honestly splits them.

Grouping must stay a render-time derivation because `PanelMessage[]` *is* the
persisted `ChatSession.messages` array, and `runLoop` replays it to the provider.
The carriers hold `toolCalls` the next request needs. Nothing in the transcript
may rewrite that array for display reasons.

**2. `TurnPhase` — an explicit, ephemeral, per-chat signal.**
`panel.svelte.ts` gains `turnPhaseByChat`, keyed by chat id exactly like
`streamingByChat` and for the same reason (decisions/25 §3): a turn belongs to a
chat, not to the visible tab. The phase is `waiting` | `streaming` |
`awaiting-approval` | `calling`, written by `agentLoop.ts` and cleared in
exactly one place — `runAgentTurn`'s outer `finally`, the single point all exit
paths unwind through. Every other transition is a *replacement*, never a clear,
which is what guarantees the indicator cannot blink off mid-turn.

It is **never persisted**. A stored "calling…" would be a lie the moment the
panel reopens. The honest consequence: a group whose last step is `pending` with
no live phase renders as *no result recorded*, never as a spinner that will never
resolve.

`panel.isStreaming` keeps its current narrow meaning ("tokens are landing in
message X") and its current job of suppressing `MessageActions` mid-reply. The
new `panel.isTurnActive` is the broader "a turn is in flight" predicate, and is
what the Stop button and the new-chat guard should have been reading all along.

## Consequences and the choices behind them

**The transcript compacts; the call log does not.** `CallLogEntry.svelte` (card
11) stays the accountability surface and keeps auto-expanding a call's arguments.
Collapsing the transcript is therefore a change to the *reading* surface, not a
reduction in what is recorded or reachable.

**A collapsed group may never hide a fact that matters.** Its summary line
carries the count, up to two tool names, `via <ServerName>` for any remote call
(decisions/19 §6), and counts of failed / denied / approved calls. A group
containing an error or a denied call does not auto-collapse at all.

This is a deliberate narrowing of `ToolCallCard`'s old rule, which also kept
*approved* calls expanded. That rule was written for a world with no summary
row; now `· 1 approved` in the summary keeps the human decision visible
(decisions/05) without holding the whole group open.

**A server-supplied `toolMcpAnnotations.title` is not a row's label.** It is
attacker-influenceable text that decisions/19 §2 already marks display-only.
Using it as the primary label would let a remote server relabel `delete_all` as
"Read page (safe)" in the one place a user scans. `ApprovalCard` renders the raw
`call.name` for exactly this reason. The title still appears inside the expanded
payload, explicitly attributed: *The server calls this: "…"*.

**No verb dictionary.** The live line says `Calling <toolName> on <origin>…` and
`Waiting for <model>…` — not "Reading the page…" or "Thinking…". We do not know
what a tool does; we know its name and where it runs. "Thinking" in particular is
the same claim `Transcript.svelte` already refuses to make with a fake "Show
thinking" disclosure, since no reasoning tokens are captured.

**`prefers-reduced-motion` is handled per component**, next to each animation it
disables — not as a global `* { animation: none !important }`, which would also
defeat `Tooltip.svelte`'s deliberate `transition-delay` (its documented
anti-strobe mechanism). This is the repo's first reduced-motion handling.

**The approval card stays outside the timeline.** It is the one thing that
*blocks* the loop; nesting it in the rail would make a pending decision read like
a completed step, and would force the timeline component to import the approvals
store it otherwise knows nothing about.

## Alternatives rejected

- **Deriving the live phase from the messages** (e.g. "last tool row is pending")
  instead of an explicit signal. It cannot distinguish "waiting for the model"
  from "idle", and it goes blank in the gaps between a tool result and the next
  request — the exact flicker this decision exists to avoid.
- **Storing group boundaries on the messages.** Would put a display concern into
  the array the provider replays, for no gain over a pure derivation.
- **Keeping the blinking cursor alongside the new indicator.** Two progress
  affordances in two places, one of which says nothing. Deleted.

Implemented by boards/project-backlog/60-turn-phase-signal.md and
boards/project-backlog/61-tool-activity-timeline.md.

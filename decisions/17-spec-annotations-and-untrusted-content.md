---
status: Accepted
date: 2026-08-19
---
# Decision 17 — Spec-strict annotations; `untrustedContentHint` fences tool results

Supersedes [decisions/05](05-tool-approval-policy.md).

## Context

Decision 05 derived the approval policy from `annotations.readOnlyHint`, and
mentioned `destructiveHint` alongside it.

`destructiveHint` is not in the WebMCP IDL. `ToolAnnotations` has exactly two
members, `readOnlyHint` and `untrustedContentHint`, both defaulting to `false`.
This was confirmed against Chrome 151/152: `getTools()` returns exactly
`{ readOnlyHint, untrustedContentHint }`, and strings extracted from the Chrome
binary contain both names and no `destructiveHint`.

This is not merely a naming difference. `ToolAnnotations` is a WebIDL
dictionary, and WebIDL dictionary conversion **silently discards unknown
members**. A page that sets `destructiveHint` has it dropped by Chrome before
`getTools()` ever returns. Once we read through the native API
([decisions/16](16-native-webmcp-client.md)), a `destructiveHint`-based rule is
not a non-standard extension we could choose to keep — it is a field that is
always absent.

`untrustedContentHint` is the genuinely important addition. It marks a tool
whose *results* may contain attacker-influenced content — the prompt-injection
surface in an agent loop, where a tool result is fed straight back to the model
as context.

## Decision

**Annotations are exactly the two spec fields.** `destructiveHint` is removed
from `ToolAnnotations`, the protocol, the approval policy, and the UI.

**Approval policy** (otherwise unchanged from decision 05):

- `annotations.readOnlyHint === true` → **run automatically**, rendered as a
  collapsed tool card.
- anything else, including a tool with no annotations → **require explicit
  approval**. Absence of a hint is treated as mutating, never as safe.

Denying still returns "user denied this call" to the model. The global
overrides (*always confirm* / *auto-run everything*) and per-tool
session approval are unchanged.

**Untrusted content handling** — new:

- A result from a tool with `untrustedContentHint === true` is **fenced**
  before it enters the model's context: wrapped in an explicit delimiter and
  labelled as untrusted data that must be treated as content, never as
  instructions.
- The transcript marks such results visibly, so a human reading the chat can
  see which content came from an untrusted source.
- The hint escalates nothing about approval — an untrusted-content tool that is
  also `readOnlyHint` still auto-runs. It changes how the *output* is handled,
  not whether the call happens.

## Consequences

- We lose the ability to distinguish "mutating" from "destructive" in the UI.
  In practice this costs little: both required explicit approval under
  decision 05 anyway, so the approval behaviour is unchanged. Only the badge
  wording changes.
- Annotations remain page-supplied and remain untrustworthy in a security
  sense — a hostile page can label a destructive tool `readOnlyHint`, or omit
  `untrustedContentHint` on a tool returning attacker-controlled text. This is
  UX guidance and defence-in-depth, not a security boundary. The boundary is
  still that the user chose to open the panel on that site.
- Fencing untrusted results is a real, if partial, mitigation for the most
  obvious prompt-injection path into the agent loop. It is worth doing
  precisely because the annotation cannot be trusted to be present.

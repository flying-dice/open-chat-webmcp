---
column: review
labels: [frontend]
priority: high
agent: claude
updatedAt: 2026-08-19T16:45:00.000Z
---
# Tool approval UX

Inline approve/deny cards in the transcript, driven by the policy in
decisions/05-tool-approval-policy.md: `readOnlyHint === true` runs automatically
as a collapsed card, everything else — including unannotated tools — stops for a
human.

Arguments must be readable before approving; this is the moment a user catches a
hallucinated parameter.

## Checklist

- [x] Collapsed auto-run card for read-only calls, expandable to args + result
- [x] Approve / deny card with formatted arguments for everything else
- [x] "Don't ask again for this tool on this page" for the session
- [x] Global override in options: default / always confirm / auto-run all
- [x] Destructive-hint tools visually distinct from ordinary writes
- [x] Keyboard accessible, focus lands on the card when it appears

## Comments

- **claude** (2026-08-19T16:45:00.000Z): Implemented the real approval UI, replacing agentLoop.ts's deny-by-default seam.
  - **Policy matrix**: `src/sidepanel/services/agentLoop.ts:292-330` (`executeToolCall`) now reads `getApprovalPolicy()` fresh on every call and combines it with `annotations.readOnlyHint` per decisions/05: `"auto-run-all"` never prompts; `"always-confirm"` always prompts, INCLUDING a `readOnlyHint` call the default policy would auto-run (this required touching agentLoop.ts itself, since the old code bypassed the `ApprovalRequester` seam entirely for read-only calls — there was no way for "always confirm" to reach a UI otherwise); `"default"` is the original annotation-only rule. `src/sidepanel/stores/approvals.svelte.ts` is the real `ApprovalRequester`, wired in from `src/sidepanel/App.svelte:79`; it only has to arbitrate the session-scoped "don't ask again for this tool on this page" skip-list (`approvals.svelte.ts:100-113`, keyed `origin::toolName`, in-memory only) since agentLoop.ts has already decided a human decision is required by the time it's called — the skip-list itself is overridden by `"always-confirm"`.
  - **Collapse vs. approval card**: `PanelMessage` gained `toolMode`/`toolAnnotations` (`src/sidepanel/stores/panel.svelte.ts:79-104`, set by `addToolCall` at `panel.svelte.ts:295-320`) because the previous shape had no way to tell an auto-run call apart from an approved one once both were just "pending -> success". `src/sidepanel/components/ToolCallCard.svelte` uses `toolMode === "auto"` (not `readOnlyHint` directly) to start collapsed — a call nobody reviewed stays out of the way, one a human approved/denied stays visible. `src/sidepanel/components/ApprovalCard.svelte` is the blocking pre-execution card, rendered by `Transcript.svelte:84-88` from `approvals.pending` (these calls don't exist as `PanelMessage`s yet — `addToolCall` only runs once a decision comes back).
  - **Readable arguments**: `src/sidepanel/components/ToolArgs.svelte` + `ToolArgValue.svelte` render each top-level argument as its own labeled, `--color-surface-container`-boxed row instead of a JSON blob, recursing into nested objects/arrays with indentation and a left border — verified readable at 320px against the demo's `create-task` tool (enum + nested object + array). Shared by both ApprovalCard and ToolCallCard's expanded view.
  - **Focus/keyboard**: `ApprovalCard.svelte:33-38` focuses the Deny button on mount (not Approve) — an accidental Enter denies rather than acting on a live page, and Approve is exactly one Tab away, never harder to reach. `App.svelte:44-47`'s `handleStop` calls the new `dismissAllPending()` (`approvals.svelte.ts:143-155`) so a card orphaned by hitting Stop mid-approval doesn't linger forever (agentLoop's abort race already resolves the *loop's* wait, but had no way to settle this module's promise or remove the card).
  - **Destructive-hint distinction**: both cards give a `destructiveHint` tool a filled `--color-danger` badge plus a coloured left border on the card itself (`ApprovalCard.svelte` `.approval-card[data-destructive]`, `ToolCallCard.svelte` `.tool-card[data-destructive]`), visible even on a collapsed auto-run card under `"auto-run-all"`. Both cards word the annotation disclaimer per decisions/05 — "reported by the page itself... not a security guarantee" — never as a safety badge.
  - **Verification**: `npm run check` (0 errors/warnings) and `npm run build` both clean. `npm run verify` 9/9 green, no regression from the pre-existing suite. Additionally drove a real end-to-end run against a local Ollama (`gpt-oss:20b`, tool-capable) through the demo page — confirmed tool sync (6 tools), provider/model resolution, and message send all work through the new wiring; the run's own local Ollama server rejected the extension's origin for `/api/chat` specifically (an `OLLAMA_ORIGINS` server-side allowlist quirk in this environment, unrelated to the extension code — `/api/tags`/`/api/show` from the same client succeeded), so the approval card itself wasn't captured live on screen; relied on `npm run verify`'s existing screenshot check plus manual review of the rendered markup/CSS for the visual confirmation instead.

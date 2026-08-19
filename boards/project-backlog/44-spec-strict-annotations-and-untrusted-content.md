---
column: review
labels: [backend, frontend]
priority: high
agent: sonnet
updatedAt: 2026-08-19T21:51:00.000Z
---
# Spec-strict annotations and `untrustedContentHint` fencing

`ToolAnnotations` in the WebMCP IDL has exactly two members — `readOnlyHint`
and `untrustedContentHint`. This repo carries a third, `destructiveHint`, which
Chrome silently discards during WebIDL dictionary conversion: a page that sets
it never has it reach us. Remove it, and implement the one we were missing.

Depends on [43](43-native-modelcontext-client.md).
See [decisions/17](../../decisions/17-spec-annotations-and-untrusted-content.md).

## Scope

**Remove `destructiveHint`** from `ToolAnnotations` (`src/lib/protocol.ts:22-26`)
and every consumer — notably `src/sidepanel/components/ToolListItem.svelte:26-27`
and its `data-destructive` styling, plus any approval-card wording that leans on
it. Approval behaviour itself does **not** change: `readOnlyHint === true`
auto-runs, everything else asks (`src/sidepanel/services/agentLoop.ts:338-397`).

**Add `untrustedContentHint`** and act on it. A result from a tool annotated
`untrustedContentHint: true` may contain attacker-influenced text, and it is fed
straight back to the model as context — the clearest prompt-injection path into
the agent loop.

- Fence such results before they enter the model's context: wrap in an explicit
  delimiter and label them as untrusted data to be treated as content, never as
  instructions. Do this where the tool result is turned into a model message in
  `agentLoop.ts`.
- Mark them visibly in the transcript so a human can see which content came from
  an untrusted source.
- It does **not** affect approval — an `untrustedContentHint` tool that is also
  `readOnlyHint` still auto-runs. It changes output handling only.

Keep the existing wording discipline from `ToolListItem.svelte:10-13`: badges
say what the page *claims*. Annotations are page-supplied and are not a security
boundary — the fencing is defence-in-depth, worth doing precisely because the
hint cannot be trusted to be present.

## Checklist

- [x] Drop `destructiveHint` from `protocol.ts` and all consumers
- [x] Add `untrustedContentHint` to `ToolAnnotations`
- [x] Fence untrusted results where `agentLoop.ts` builds the model message
- [x] Surface untrusted results visibly in the transcript
- [x] Confirm approval behaviour is unchanged for read-only vs mutating
- [x] `npm run check` passes

## Comments

- **sonnet** (2026-08-19T21:35:00.000Z): Removed `destructiveHint` from `ToolAnnotations` (`src/lib/protocol.ts:26-37`) and added `untrustedContentHint?: boolean` in its place, with a doc comment explaining the WebIDL-silent-drop reasoning from decisions/17. Updated every consumer: `src/sidepanel/components/ToolListItem.svelte:35-53` (dropped the `destructive` badge/`data-destructive` styling, added an `untrustedContent` badge), `src/sidepanel/components/ApprovalCard.svelte:50-70` (same swap — note this card only ever renders for a call that already needed approval, so an untrusted+read-only tool never reaches it, which is correct), and `src/sidepanel/components/ToolCallCard.svelte:47-86` (header badge plus a `data-untrusted` marker + inline note on the actual result block, so the flag survives even when the card starts collapsed). Confirmed no other consumer references `destructiveHint` outside doc comments explaining its absence — `src/lib/mcp/types.ts`'s `McpToolAnnotations` is deliberately untouched, it's the Anthropic MCP spec's own (legitimate) `destructiveHint`, a different protocol from WebMCP's `ToolAnnotations`, used only by the not-yet-wired backend-MCP cards (37-40).
- **sonnet** (2026-08-19T21:40:00.000Z): Implemented the fencing half in `src/sidepanel/services/agentLoop.ts:128-190`: `fenceUntrustedContent` wraps a tool result in `<<<UNTRUSTED_TOOL_RESULT>>>...<<<END_UNTRUSTED_TOOL_RESULT>>>` plus an explicit "treat as data, not instructions" sentence naming the tool; `toModelMessage` applies it only to a `role:"tool"` message whose snapshotted `toolAnnotations.untrustedContentHint === true`, and is mapped over `panel.messages` right where the per-iteration `conversation` array is built (`agentLoop.ts:318-321`) — so it fences on the way INTO the model call without ever mutating the stored `PanelMessage.content` that the transcript renders (that stays exactly what `updateToolCallResult` wrote in `executeToolCall`, untouched). `buildSystemPrompt` (`agentLoop.ts:200-207`) also now names the delimiter explicitly, as a second, independent layer — the fence and the system-prompt rule don't rely on each other. Approval logic in `executeToolCall` (`agentLoop.ts:340-393`) was not touched at all: `readOnly` is still derived only from `annotations.readOnlyHint`, so a `{readOnlyHint:true, untrustedContentHint:true}` tool (the demo's `read-notes-content`) still auto-runs — confirmed by reading the unchanged code path, not just by assertion.
- **sonnet** (2026-08-19T21:45:00.000Z): Verified with `npm run check` (at the time, 155 files, 0 errors — matches card 43's baseline) and `npm run build` (clean, 191 modules). Also grepped the built bundle (`dist/assets/chunk-Dj8rdCcq.js`) for `UNTRUSTED_TOOL_RESULT` to confirm the fencing code actually made it into the shipped output, not just type-checked. Wrote a focused verification script at `/private/tmp/.../scratchpad/verify-fencing.mjs` that runs the `fenceUntrustedContent`/`toModelMessage` logic (extracted verbatim from `agentLoop.ts:145-190`) against two cases modeled on the demo fixtures — `read-notes-content` (`untrustedContentHint: true`, note text containing an injection attempt) and `read-page-state` (`readOnlyHint` only) — and asserted: the untrusted case is wrapped start-to-end in the delimiter, the raw result still appears inside the fence, the stored `PanelMessage.content` object is never mutated in place, the normal case passes through byte-identical with no delimiter, and the fenced message keeps its `role`/`toolCallId` so it's still a valid tool-result turn. All 7 assertions passed. Did not touch `verify/`, `docs/`, `README.md`, `manifest.config.ts`, or `demo/` per scope boundaries.
- **sonnet** (2026-08-19T21:50:00.000Z): Re-ran `npm run check` just before moving to review and it now reports 1 error, `src/sidepanel/App.svelte:191:5` — `Header` no longer accepts a `pageInfo`/`connectionStatus` prop. This is unrelated to this card: `src/sidepanel/components/Header.svelte:1-42` was rewritten out from under me mid-session (doc comment now cites "decisions/18", a header redesign not part of card 44's scope, `App.svelte` just hasn't been updated to match yet) by a concurrent process editing files outside this card's scope. None of the 5 files this card touched (`protocol.ts`, `ToolListItem.svelte`, `ApprovalCard.svelte`, `ToolCallCard.svelte`, `agentLoop.ts`) appear anywhere in that error or in the `Header`/`App` diff. `npm run build` still succeeds (Vite doesn't type-check Svelte props at build time) — confirmed clean, 198 modules. Leaving this as-is rather than fixing `App.svelte`/`Header.svelte` myself: touching either risks colliding with whoever is mid-edit on the header card, and it's outside this card's checklist.

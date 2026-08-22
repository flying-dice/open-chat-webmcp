---
column: todo
labels: [frontend]
priority: med
updatedAt: 2026-08-22T12:00:00.000Z
---
# Approvals and tools/call-log inspector on shadcn-svelte

Migrate the approval card and the inspector views per
decisions/28-shadcn-svelte-maia-zinc.md. ApprovalCard.svelte stays a
blocking, fully keyboard-operable card (Card + Button + Badge — approve /
deny / skip semantics untouched). Inspector.svelte's inner Tools ↔ Call Log
switch moves to Tabs. Tools view: ToolsPanel.svelte (three distinct empty
states → Empty component), ToolListItem.svelte (Card + Collapsible +
Badge), ToolSchema/SchemaProperty (recursive), ToolArgs/ToolArgValue
(recursive). Call log: CallLogPanel.svelte, CallLogEntry.svelte (args,
result/error, duration, mode). Delete scoped CSS as each migrates; use
ScrollArea where lists scroll.

## Checklist

- [ ] ApprovalCard migrated: focus capture, keyboard operation, approve/deny/skip flows identical
- [ ] Inspector on Tabs; Tools and Call Log switch as before
- [ ] ToolsPanel's three empty states preserved (no tools / unavailable / restricted)
- [ ] Recursive schema and args renderers migrated without truncating deep structures
- [ ] CallLogEntry shows args, result/error, duration, and mode badges as before
- [ ] All scoped CSS removed from the nine components
- [ ] npm run check, npm run build and npm run verify green

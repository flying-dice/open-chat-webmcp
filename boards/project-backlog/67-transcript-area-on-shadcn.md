---
column: todo
labels: [frontend]
priority: high
updatedAt: 2026-08-22T12:00:00.000Z
---
# Transcript area on shadcn-svelte

Migrate the transcript column per decisions/28-shadcn-svelte-maia-zinc.md,
preserving behaviour exactly: autoscroll pinning + "Jump to latest" pill,
streaming message rendering, notices snippet, activity groups with their
tool-call rails, and the live activity indicator (its shimmer keyframes are
a legitimate custom-CSS exception per Decision 28).

Components in scope: Transcript.svelte, src/lib/components/Markdown.svelte
(restyle its 160 CSS lines with Tailwind typography-style utilities — keep
the DOMPurify pipeline untouched), MessageActions.svelte,
NoticeCard.svelte (→ Alert), ActivityIndicator.svelte,
ActivityGroup.svelte (→ Collapsible), ToolCallRow.svelte (216 CSS lines —
Badge/Collapsible + utilities). Delete scoped CSS as each migrates.

## Checklist

- [ ] Transcript, Markdown, MessageActions, NoticeCard, ActivityIndicator, ActivityGroup, ToolCallRow migrated; scoped CSS removed (shimmer keyframes only exception)
- [ ] Autoscroll pinning and jump-to-latest behave identically during streaming
- [ ] Markdown rendering visually correct in light and dark (code blocks, lists, links, tables)
- [ ] Restricted-page and cross-origin-mismatch notices render and dismiss as before
- [ ] Activity rail expand/collapse and per-call status glyphs intact
- [ ] npm run check, npm run build and npm run verify green

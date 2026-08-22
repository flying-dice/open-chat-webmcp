---
column: todo
labels: [frontend]
priority: med
updatedAt: 2026-08-22T12:00:00.000Z
---
# Chat history views on shadcn-svelte

Migrate HistoryPanel.svelte and HistoryListItem.svelte per
decisions/28-shadcn-svelte-maia-zinc.md: the full cross-origin history list
(newest first) with per-row title, origin, counts, and delete action.
Rebuild rows on Item/Card + Button patterns inside a ScrollArea; delete the
141 lines of scoped CSS. Open-chat and delete flows (including
discardActiveChatIfDeleted behaviour) stay untouched — this is presentation
only.

## Checklist

- [ ] HistoryPanel + HistoryListItem migrated; scoped CSS removed
- [ ] Row click opens the chat; delete removes it and updates the list without opening it
- [ ] Origin + message/tool-call counts render as before; long titles truncate cleanly
- [ ] Empty state uses the Empty component
- [ ] npm run check, npm run build and npm run verify green

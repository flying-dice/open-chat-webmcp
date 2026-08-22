---
column: todo
labels: [frontend]
priority: high
updatedAt: 2026-08-22T12:00:00.000Z
---
# Side-panel shell on shadcn-svelte

Migrate the side panel's shell to shadcn-svelte components per
decisions/28-shadcn-svelte-maia-zinc.md, keeping the exact screen structure
and flows: Header (inline-renameable title, icon actions, kebab), the
OverflowMenu (recent chats + More, tools inspector, settings), the
chat/inspector/history view switch with its Back subview bar, and the
overall column layout of App.svelte. Same behaviours, new components.

Components in scope: App.svelte (layout + subview bar only — leave
handleSend etc. alone), Header.svelte, OverflowMenu.svelte (→
DropdownMenu), IconButton.svelte + Tooltip.svelte (→ Button
variant="ghost" size="icon" + shadcn Tooltip), SegmentedControl.svelte (→
Tabs), Icon.svelte (→ Hugeicons for standard glyphs; keep sparkle + Ollama
marks as local SVGs, shrinking src/lib/icons.ts accordingly). Delete each
component's <style> block as it migrates; no new custom CSS.

Keep accessible names/roles stable ("More options" menu button, menuitem
roles) — verify/checks/screenshots.mjs locates UI by them; update that file
in this card if a name must change.

## Checklist

- [ ] Header, OverflowMenu, IconButton/Tooltip, SegmentedControl, Icon migrated; scoped CSS removed
- [ ] App.svelte shell layout on Tailwind utilities; view switching and Back bar behave identically
- [ ] Inline title rename still works (focus, commit on Enter/blur)
- [ ] Hugeicons replace Material Symbols paths for standard glyphs; icons.ts reduced to custom marks
- [ ] Overflow menu keyboard navigation intact (arrow keys, Escape)
- [ ] Screenshot-check selectors still match (or updated in verify/checks/screenshots.mjs)
- [ ] npm run check, npm run build and npm run verify green

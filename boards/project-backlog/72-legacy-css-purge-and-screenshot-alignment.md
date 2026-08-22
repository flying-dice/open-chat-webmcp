---
column: todo
labels: [frontend, infra]
priority: high
updatedAt: 2026-08-22T12:00:00.000Z
---
# Legacy CSS purge and screenshot alignment

Close out the UI phase per decisions/28-shadcn-svelte-maia-zinc.md: with all
components migrated, delete src/lib/theme.css and
src/sidepanel/chat-theme.css (including the html:root specificity trick and
the 10-vs-17-token twin palettes), remove their imports from both main.ts
files, and sweep src/ for any straggler custom CSS, dead classes, or
remaining Material Symbols usage. Then re-verify the harness's best-effort
screenshot checks actually PASS (they degrade silently to SKIP when
accessible names drift — check the report output, not just the exit code)
and capture a fresh light/dark × 320/400px screenshot matrix. Update
docs/01-architecture.md's UI/styling description and the README screenshots
if referenced.

## Checklist

- [ ] theme.css and chat-theme.css deleted; entry imports reduced to src/app.css
- [ ] No <style> blocks left outside Decision 28's exceptions; grep confirms no legacy token vars (--color-*, --space-*, --elevation-*) remain
- [ ] verify screenshot checks report PASS (not SKIP) for all 9 captures; selectors updated where needed
- [ ] Fresh screenshot matrix captured and stale root-level Screenshot*.png files replaced or removed
- [ ] docs/01-architecture.md styling section updated for Tailwind/shadcn
- [ ] npm run check, npm run build and npm run verify green

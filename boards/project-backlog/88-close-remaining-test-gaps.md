---
column: todo
labels: [backend, infra]
priority: med
updatedAt: 2026-08-23T06:30:00.000Z
---
# Close the remaining test gaps

Cards 83 and 85 journalled the areas still without coverage. Close them per
decisions/30-vitest-test-pyramid.md and the chaos-monkey skill's standards:

- **MCP transport internals** (card 83's scope note): dedicated tests for
  src/infra/mcp/{gateway,connect,session,streamable-http,legacy-sse,results}.ts
  over stubbed fetch — transport selection/fallback, session initialize
  validation, streamable-http happy/fault paths, legacy SSE lifecycle,
  result decoding.
- **Chaos gaps** (card 85's journal): a `runtime:call-tool-response`
  arriving for a superseded turn (background sw.ts routing — test the
  router's registry/broker logic in isolation or via a thin seam);
  401-mid-tool-call in streamable-http.ts/legacy-sse.ts (token expiry
  between connect and call); replayed approval decisions in
  src/sidepanel/stores/approvals.svelte.ts (approve/deny delivered twice,
  approval for a dismissed request).

## Checklist

- [ ] Transport modules covered with happy-path + fault tests
- [ ] The three chaos gaps covered under describe('chaos: …') blocks
- [ ] Any new real bug found is pinned (it.fails + journal), not silently fixed
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

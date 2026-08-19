---
column: backlog
labels: [backend]
priority: high
updatedAt: 2026-08-20T10:30:00.000Z
---
# Merge namespaced MCP tools into the agent loop

DEPENDS ON card 37. The second half of decisions/14-backend-mcp-servers.md: the
model sees ONE tool list combining the current page's WebMCP tools and the tools
of every enabled MCP server, namespaced by server so nothing can collide.

The approval policy (decisions/05-tool-approval-policy.md) applies unchanged to
both kinds — `readOnlyHint` runs automatically, everything else asks.

What needs real care is that "read-only" means something very different for a page
you are looking at and a remote service you are not. The approval card and the
inspector must make WHERE a call will execute unmistakable, so a user is never
approving a remote action believing it is a local one. That is a UI honesty
requirement, not a nicety.

Dispatch is now conditional: page tools route through the worker to the content
relay, server tools go straight out over HTTP from the panel. The agent loop
should not grow two parallel code paths — resolve a tool to its executor once, at
the point the merged list is built.

## Checklist

- [ ] Namespacing scheme safe in model-facing tool names; picked and documented
- [ ] Merged list built once, each tool carrying its executor
- [ ] Page tools still route via the worker; server tools call the MCP client
- [ ] Approval and inspector show where a tool executes, unmistakably
- [ ] Call log records the tool's origin alongside args and result
- [ ] A dead server degrades to "its tools are unavailable", never a broken loop
- [ ] Header values never reach the call log (decisions/15)

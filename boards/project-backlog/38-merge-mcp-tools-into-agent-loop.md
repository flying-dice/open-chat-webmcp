---
column: backlog
labels: [backend]
priority: high
updatedAt: 2026-08-20T10:30:00.000Z
---
# Merge namespaced MCP tools into the agent loop

DEPENDS ON card 37 (done, in review). The second half of
decisions/14-backend-mcp-servers.md. The mechanics are settled in
**decisions/19-merging-server-tools-with-page-tools.md** — read it first; it
picks the namespace separator, resolves the two annotation vocabularies,
requires remote results to be fenced, and rules out blocking the page on server
discovery. This card implements it. The
model sees ONE tool list combining the current page's WebMCP tools and the tools
of every enabled MCP server, namespaced by server so nothing can collide.

The approval policy applies unchanged to both kinds — `readOnlyHint` runs
automatically, everything else asks. Note decisions/05 is now superseded by
decisions/17-spec-annotations-and-untrusted-content.md, which kept that rule but
removed `destructiveHint` from WebMCP annotations and added untrusted-content
fencing. MCP's own `destructiveHint` is a different, still-valid vocabulary —
see decisions/19 §2, and do not trim `McpToolAnnotations` to match WebMCP's.

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

- [ ] Namespacing per decisions/19 §1 (`server__tool`, page tools bare, collisions to the page)
- [ ] Merged list built once, each tool carrying its executor
- [ ] Page tools still route via the worker; server tools call the MCP client
- [ ] Approval, tools list and call log show where a tool executes, unmistakably
- [ ] Remote results fenced as untrusted (decisions/19 §3)
- [ ] Server discovery cached off the turn's critical path (decisions/19 §4)
- [ ] Missing host permission reported as that specific reason, not a generic failure
- [ ] Call log records the tool's origin alongside args and result
- [ ] A dead server degrades to "its tools are unavailable", never a broken loop
- [ ] Header values never reach the call log (decisions/15)

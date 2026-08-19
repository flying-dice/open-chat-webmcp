---
column: backlog
labels: [frontend]
priority: med
updatedAt: 2026-08-20T10:30:00.000Z
---
# MCP server management UI

DEPENDS ON card 37. Options-page section to add, edit, remove, enable/disable and
test MCP servers, per decisions/14-backend-mcp-servers.md.

Mount it as a sibling section alongside the providers and settings sections — card
22 established the layout shell and card 13 the second section, so this is the
third. Reuse that shell rather than inventing a third visual pattern.

"Test connection" should do a real handshake and `tools/list`, then show WHAT it
found — the tool names — not just a green tick. Discovering that a server connects
but exposes nothing useful is the common failure, and a tick hides it.

## Checklist

- [ ] Server list: add / edit / remove / enable / disable / reorder
- [ ] URL, display name, auth, and custom headers (decisions/15) with masked values
- [ ] Host permission request from a user gesture, with grant state shown
- [ ] Test connection performs a real handshake and lists discovered tools
- [ ] Distinct failure messages: unreachable, auth rejected, not an MCP endpoint
- [ ] Empty state explaining what an MCP server is and that remote-only is supported
- [ ] Note that credentials and header values are stored unencrypted locally

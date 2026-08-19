---
column: todo
labels: [backend]
priority: high
updatedAt: 2026-08-20T10:30:00.000Z
---
# MCP server registry and remote client

"As a user I should be able to add custom MCP servers from backend MCPs so that I
can integrate with tools not in the current UI."

Implements the transport and storage half of
decisions/14-backend-mcp-servers.md. Cards 38 (merging into the loop) and 39 (the
management UI) build on this.

Remote transports only — streamable HTTP and SSE. No stdio, no helper process; a
browser extension cannot spawn a subprocess. Local stdio servers are reached via
an off-the-shelf proxy the user runs, which we document rather than ship.

Follow the shape the provider registry already established
(decisions/10-provider-registry-and-credential-storage.md): configs in
`chrome.storage.sync`, credentials and custom header values in
`chrome.storage.local`, never-throw result types, host access via
`chrome.permissions.request` from a user gesture.

Per-server failure isolation is a hard requirement: one slow or dead server must
never stop the page's own tools from being offered.

## Checklist

- [ ] MCP client over streamable HTTP + SSE, partial-event safe like the OpenAI client
- [ ] Initialize/handshake, `tools/list`, `tools/call` with typed results
- [ ] Server config type + registry CRUD, mirroring the provider registry
- [ ] Optional auth and custom headers (decisions/15-custom-headers-are-credentials.md)
- [ ] Host permission request flow per server
- [ ] Per-server timeout and failure isolation; never block page tools
- [ ] Named error kinds — unreachable, auth, protocol mismatch — not bare strings

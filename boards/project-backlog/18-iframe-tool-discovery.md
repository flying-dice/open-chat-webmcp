---
column: backlog
labels: [frontend]
priority: low
updatedAt: 2026-08-19T15:05:56.000Z
---
# Iframe tool discovery

v1 injects into the top frame only (decisions/02-mainworld-webmcp-bridge.md).
Pages that publish tools from an embedded app — checkout widgets, embedded
dashboards — are invisible to us.

Extending to `all_frames` means namespacing tools by frame, deciding what a tool
name collision across frames means, and routing a call back to the frame that
registered it. Deferred until a real site needs it.

## Checklist

- [ ] Decide on frame-qualified tool identity and collision handling
- [ ] Route calls to the originating frame
- [ ] Show frame origin in the inspector
- [ ] Consider the cost of injecting into every ad iframe on the web

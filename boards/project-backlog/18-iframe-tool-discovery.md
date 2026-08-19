---
column: backlog
labels: [frontend]
priority: low
updatedAt: 2026-08-19T23:30:00.000Z
---
# Iframe tool discovery

v1 injects into the top frame only (`all_frames: false` in
`manifest.config.ts`). Pages that publish tools from an embedded app —
checkout widgets, embedded dashboards — are invisible to us.

**Update (2026-08-19, card 47):** this was originally deferred because
iframe tool identity had no defined semantics — there was no API to hang the
decision on. That's no longer true. Since
[decisions/16](../../decisions/16-native-webmcp-client.md), the extension
reads the native `document.modelContext` API directly, and that API *does*
define cross-frame identity: `registerTool`'s `exposedTo` option controls
which frames a tool is visible to, `getTools({ fromOrigins })` filters
discovery by origin, and every `RegisteredTool` returned carries its own
`origin` and a live `window` reference identifying the frame that registered
it — `src/content/relay.ts` already uses `window` today to scope its
top-frame-only lookups so a same-named subframe tool can't shadow one in the
top frame (see [docs/01-architecture.md](../../docs/01-architecture.md)).
**The platform question this card was blocked on is answered.** What's left
is purely an implementation decision — namespacing collisions across frames
in our own UI, routing a worker-issued call to the right frame's relay
instance, and deciding whether injecting a content script into every ad
iframe on the web is worth the cost — not a research question. Still not
committed to for this batch; remains deferred until a real site needs it.

## Checklist

- [ ] Decide on frame-qualified tool identity and collision handling (the
      native `exposedTo`/`fromOrigins`/`origin`/`window` primitives now exist
      to build this on — see the update above)
- [ ] Route calls to the originating frame
- [ ] Show frame origin in the inspector
- [ ] Consider the cost of injecting into every ad iframe on the web

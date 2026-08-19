---
column: backlog
labels: [frontend, docs]
priority: low
updatedAt: 2026-08-19T00:00:00.000Z
---
# Design a clear Chrome Web Store storefront page

Card 19 covers the mechanics of shipping a listing (zip, privacy policy,
permission justifications). This card is the visual/copy design pass on the
storefront page itself — the thing a stranger sees before installing, under
the "OpenChat (WebMCP)" branding (decisions/12-branding-openchat-webmcp.md).

The core challenge: explain "local-first chat that can drive the page you're
looking at via WebMCP tools" to someone with no context, in the space of a
store tile, a short description, and five screenshots — and make the
`<all_urls>` + optional host permissions read as trustworthy rather than
alarming (decisions/08-native-chrome-design-language.md sets the visual tone
to draw from).

## Checklist

- [ ] One-sentence value prop + short description copy
- [ ] Promo tile / hero graphic (1280x800 and small tile sizes)
- [ ] Screenshot set: side panel chat, tool approval UX (card 09), a real
      WebMCP tool call in action, options/provider setup (card 13/22)
- [ ] Captions per screenshot that carry the story without reading the UI
- [ ] Permission story woven into the copy (why `<all_urls>`, why optional
      host permissions), not left to the justification form alone
- [ ] Review pass against card 19's honesty bar before submission

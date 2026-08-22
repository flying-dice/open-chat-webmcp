---
column: todo
labels: [infra, docs]
priority: high
updatedAt: 2026-08-24T11:00:00.000Z
---
# Local development workflow

Make the edit-see loop first-class. Today: scripts/launch-chrome.mjs
rebuilds dist and needs a manual "Load unpacked" in real Chrome; the verify
harness owns the only Chrome-for-Testing path; there is no watch loop, no
seeded dev profile, and no single doc telling a new contributor how to
work. Deliver:

- `npm run dev:chrome`: Chrome for Testing (auto --load-extension works
  there) + demo server + the extension rebuilt on change with the
  extension reloaded automatically (CRXJS HMR if it genuinely works for
  the side panel + options in this setup — investigate and journal; else a
  watch build + chrome.runtime reload trigger or the crx dev-reload
  mechanism). Keep scripts/launch-chrome.mjs as the real-Chrome fallback.
- `npm run dev:seed` (or a --seed flag): seed the CfT profile from the
  shared typed fixtures so the panel opens with realistic chats/providers
  instead of empty state.
- `npm run verify -- --check <name>`: run a single verify check without
  the whole suite (report shows what ran); document the tiers (required
  vs smoke scripts).
- docs/07-development.md: the loop, the scripts table, the guard suite,
  how to run one test file, the fixture/seeding story, CfT vs real Chrome,
  troubleshooting (WebMCP flag, profile resets).

## Checklist

- [ ] dev:chrome one-command loop working end to end; reload-on-change proven and its mechanism journalled
- [ ] Seeding from shared fixtures working; documented
- [ ] Single-check verify runner working; verify README/tier docs updated
- [ ] docs/07-development.md written; README points at it
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green

---
column: backlog
labels: [infra]
priority: low
updatedAt: 2026-08-23T09:30:00.000Z
---
# Packaging and Web Store listing

Only worth doing once the extension is genuinely usable. The permission
justifications are the substantive part of review: `<all_urls>` content scripts
plus optional host permissions need a clear, honest explanation, and the fact
that all inference is local is the strongest thing the listing can say.

## Checklist

- [x] Reproducible zip build from `dist/` — done, from a dedicated
      `dist-package/`, not `dist/`: `npm run package`
      (`scripts/package.mjs`), card 117, decisions/41.
- [ ] Version and changelog discipline
- [x] Privacy policy — local-only inference, no telemetry, local storage —
      the disclosure draft is `docs/08-store-listing.md`'s Privacy
      practices section, sourced from docs/03-privacy-and-trust.md.
- [x] Permission justifications for review — `docs/08-store-listing.md`.
- [ ] Screenshots and store copy — store copy is drafted
      (`docs/08-store-listing.md`); screenshots are NOT — the verify
      harness's captures are sized to the side panel (320/400px), not the
      store's screenshot dimensions, and need compositing work card 117
      flagged but didn't do. Card 27's design pass is still the place for
      that.
- [ ] Decide public listing vs unlisted

## Comments

- **claude** (2026-08-23T09:30:00.000Z): Card 117 covered this card's scope end to end except changelog discipline, the actual screenshot compositing, and the public/unlisted decision — all still open here. See card 117 and decisions/41-store-packaging.md for what shipped: `npm run package`, CI wiring, and `docs/08-store-listing.md`.

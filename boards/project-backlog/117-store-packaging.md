---
column: review
agent: claude
live: false
labels: [infra, docs]
priority: high
updatedAt: 2026-08-23T10:15:00.000Z
---
# Chrome Web Store packaging (backlog)

Not in the current sprint — filed so it stops being folklore (card 86's
release judgment noted the extension has never been made shippable). When
picked up: a `npm run package` producing a store-ready zip from a clean
build; listing copy sourced from the humanized _locales strings; privacy
disclosure derived from docs/03-privacy-and-trust.md; icon/asset audit;
MV3 review checklist (permissions justification — note the WebMCP flag
dependency through Chrome 156 constrains a public listing anyway).

See decisions/41-store-packaging.md for the packaging design (zip tool,
output directory, validation order, CI gating) and
docs/08-store-listing.md for the listing draft this card produced.

## Checklist

- [x] Package script + clean-build zip
- [x] Listing copy + privacy disclosure drafted from existing sources
- [x] Review-readiness checklist journalled with the Chrome-156 caveat

## Gates

- [x] tests-passing — `npm test`, 80 files / 1278 tests, all green (claude, 2026-08-23T10:15:00.000Z)
- [x] typecheck — `npm run check`, 1695 files, 0 errors/warnings (claude, 2026-08-23T10:15:00.000Z)
- [x] guard — `npm run guard`, all six guards green (biome, boundaries, clean-code, return-types, throws, i18n); one pre-existing depcruise no-circular self-reference warning on `ToolArgValue.svelte`, unrelated to this card (claude, 2026-08-23T10:15:00.000Z)
- [x] build — `npm run build` green, `dist/` produced (claude, 2026-08-23T10:15:00.000Z)
- [x] package — `npm run package` green: `openchat-webmcp-0.5.0.zip` built and every validation passed (version match, all 10 locales resolvable, all 4 icon sizes verified, no source maps/dev artifacts, manifest at zip root, 1.31 MB uncompressed / 426.4 KB zipped); `unzip -l` confirms manifest.json and all top-level entries sit directly at the zip root, not nested under a build-dir prefix; two consecutive runs produced byte-identical zips (same SHA-256) (claude, 2026-08-23T10:15:00.000Z)
- [x] actionlint — `actionlint .github/workflows/ci.yml` clean (claude, 2026-08-23T10:15:00.000Z)

## Comments

- **claude** (2026-08-23T09:05:00.000Z): Claimed the card. Read the skill, the card, `.github/workflows/ci.yml`, `vite.config.ts`/`manifest.config.ts`, `docs/03-privacy-and-trust.md`, `public/_locales/en`, `icons/`, and `README.md` before touching anything. Confirmed `vite build --outDir <dir>` works cleanly with the CRXJS plugin (manual test build) — no `vite.config.ts` change needed for a separate packaging output dir.

- **claude** (2026-08-23T09:45:00.000Z): Wrote `scripts/package.mjs`. Design, argued in full in decisions/41-store-packaging.md: clean production build into a dedicated `dist-package/` (never `dist/`, never reused), full validation before zipping (manifest parses; version matches `package.json`'s; all 10 `public/_locales/` directories present in the build with every `__MSG_*` key the manifest uses resolvable in each; every icon size in `manifest.icons`/`action.default_icon` exists and is verified against the file's actual PNG `IHDR` dimensions, including the store-mandatory 128px; no `.map` files or dev-server artifact strings; no `localhost:<port>` reference beyond the three legitimate provider-preset ports 11434/1234/8080 from `src/domain/providers/presets.ts`), then zip via the system `zip -X` binary (no new dependency — both this machine and `ubuntu-latest` ship it) with an explicit sorted file list and pinned mtimes for byte-for-byte determinism (verified: two runs, identical SHA-256). Added `npm run package` (package.json:10), gitignored `dist-package`/`openchat-webmcp-*.zip`.

- **claude** (2026-08-23T09:55:00.000Z): Wired CI (`.github/workflows/ci.yml`): added `tags: ["v*"]` to the push trigger, and a third job `package` (`needs: gate`, `if: github.event_name == 'push'`, job-scoped `permissions: contents: write`) that runs `npm run package`, uploads the zip as a build artifact (90-day retention), and on a `v*` tag push attaches it to a GitHub Release via `softprops/action-gh-release@v2`. Deliberately does not need `verify` — see decisions/41's reasoning. `actionlint .github/workflows/ci.yml` clean.

- **claude** (2026-08-23T10:05:00.000Z): Wrote `docs/08-store-listing.md` — name/summary/description assembled from `public/_locales/en/messages.json` plus the README's capability copy (page-context sharing and its consent gate included, per the card's ask), a Productivity category recommendation, the full Privacy practices disclosure (single purpose, a permission-by-permission justification table, and the data-usage certification answers), screenshots guidance pointing at the verify harness's matrix — flagging honestly that those captures are sized to the side panel (320/400px) and still need compositing into store-sized (1280×800/640×400) images before submission — and a review-readiness checklist stating the Chrome 156 WebMCP-flag caveat plainly: chat and page-context sharing work on stock Chrome, only page *tools* need the flag (card 120's README correction). Linked from README's Documentation list and Scripts table, and updated README's "Project status" bullet (previously "No Chrome Web Store listing") to reflect that packaging is done and only the listing submission itself remains open.

- **claude** (2026-08-23T10:10:00.000Z): Icon/asset audit: all four manifest-declared sizes (16/32/48/128) exist under `icons/` and their actual PNG dimensions match exactly what's declared — enforced automatically by `scripts/package.mjs` on every run, not just checked once by hand. Noted card 19 (`boards/project-backlog/19-packaging-and-store-listing.md`, an older backlog card with overlapping scope) as superseded by this work except for changelog discipline, the actual screenshot compositing, and the public/unlisted decision, all still open there.

- **claude** (2026-08-23T10:15:00.000Z): All gates green (see Gates section). Moving to review. What only a real runner proves: whether `ubuntu-latest`'s preinstalled `zip`/`unzip` behave identically to this machine's (Info-ZIP on both, so expected to match, but never run there yet), whether the `package` job's `if`/`needs` conditions behave as designed on an actual tag push (never triggered outside a local read of the YAML + actionlint), and whether `softprops/action-gh-release` successfully creates/attaches to a release with the default `GITHUB_TOKEN`'s permissions on this specific repo.

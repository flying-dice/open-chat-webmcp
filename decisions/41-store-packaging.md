---
status: Accepted
date: 2026-08-23
---
# Decision 41 — Store packaging: system `zip`, a dedicated build dir, CI on push/tag only

## Context

Card 86's release judgment noted the extension had never been made
shippable — there was no reproducible way to produce a Chrome Web
Store-ready zip, and CI had nothing that produced or validated one. Card
117 (`boards/project-backlog/117-store-packaging.md`) asked for a
`npm run package` script and CI wiring. Three choices in that script and
its CI job were significant enough to write down rather than leave as
implicit code:

1. how to build the zip (a new dependency vs. the platform's own tool),
2. where the build happens (reusing `dist/` vs. a dedicated output),
3. when CI produces one (every push vs. only the pushes that matter).

## Decision

**Zip tool: the system `zip` binary, not a new dependency.** `adm-zip` or
`archiver` were both acceptable per the card. Both `ubuntu-latest` (CI) and
this project's dev machines ship `zip`/`unzip` preinstalled, so reaching
for a new npm dependency — with its own supply-chain surface and a version
to keep current — bought nothing a platform tool doesn't already provide
for a one-shot, build-time task. `scripts/package.mjs` shells out via
`execFileSync("zip", ["-X", "-q", ZIP_PATH, ...files], { cwd: OUT_DIR })`,
passing an explicit, sorted file list (not `-r .`) so archive-member order
doesn't depend on filesystem traversal order, and pins every file's mtime
to a fixed instant first (`pinModificationTimes`) so the same source
produces a byte-identical zip run to run — verified locally: two
consecutive `npm run package` runs on the same tree produce the same
SHA-256. `-X` strips extra file attributes (UID/GID, Unix timestamps in
the zip extra field) that would otherwise make the archive depend on who
or where it was built.

**A dedicated `dist-package/` output, wiped before every build.** Never
`dist/` — that's also where `npm run build`, `npm run dev:chrome`, and
`npm run launch` write, and a stale build sitting there (or one built with
different flags) must never be what gets zipped and uploaded. `vite build
--outDir dist-package` works cleanly with the CRXJS plugin (confirmed by a
manual build — manifest, `_locales/`, `icons/`, and both HTML entry points
all land exactly where the default `dist/` build puts them, just under a
different root) and needs no `vite.config.ts` changes. This follows the
same pattern `dist-verify/` (the verify harness) already established:
one dedicated, gitignored output directory per concern, so no two of
build/dev/verify/package can clobber each other if run concurrently.

**Validate before zipping, not after.** Manifest parses; its version
equals `package.json`'s; every locale under `public/_locales/` is present
in the built output with every `__MSG_*` key the manifest references
resolvable; every icon size the manifest declares (`icons` and
`action.default_icon`) exists and is actually that size (a minimal
hand-rolled PNG-header reader — no dependency needed for four bytes of
IHDR); no `.map` files or dev-server artifact strings (`@vite/client`,
`import.meta.hot`, etc.) in the bundle; no unexpected `localhost:<port>`
reference beyond the three legitimate provider-preset defaults (Ollama
11434, LM Studio 1234, llama.cpp 8080 — `src/domain/providers/presets.ts`).
Any failure exits non-zero with a specific message before a zip is ever
produced, so there is no path to a zip that hasn't passed every check.

**CI: a third job, `package`, gated on `gate` and on the push event only.**
`needs: gate` — packaging code that hasn't passed check/test/guard/build
isn't worth zipping. Deliberately does *not* need `verify`: `verify` proves
the built extension works in a real browser, which is orthogonal to
whether the zip is well-formed, and gating packaging on the slower,
headed-browser job would slow down every push to `main` for no benefit to
what `package` actually checks. `if: github.event_name == 'push'` — the
workflow's only `push` triggers are a branch push to `main` or a `v*` tag
push (`on.push.branches`/`on.push.tags`), and a `pull_request` run has
nothing to attach a release zip to, so the job (and the `contents: write`
permission override scoped to it alone) simply doesn't run for one. The
zip is uploaded as a build artifact on every run (90-day retention — the
actual release deliverable, kept well past the 14-day verify-screenshots
retention) and, only on a tag push (`startsWith(github.ref,
'refs/tags/v')`), attached to a GitHub Release via
`softprops/action-gh-release@v2`, which creates the release if the tag
doesn't have one yet.

## Consequences

- `npm run package` is the one command that produces an upload-ready zip;
  nobody should hand-zip `dist/`.
- Cutting a release is "push a `v*` tag" — CI does the build, validation,
  zip, artifact upload, and release attach with no manual packaging step.
- The system-`zip` choice means this script assumes a POSIX-ish `zip`/
  `unzip` on `PATH`. Not true on a bare Windows dev machine; not a
  constraint anywhere this project currently runs (macOS dev, `ubuntu-latest`
  CI). If that changes, revisit toward `adm-zip`/`archiver` rather than
  shipping a second code path.
- The validations catch what they check for and nothing else — they are
  not a substitute for `npm run verify` (a real browser exercising the
  built extension) or for a human loading the zip's contents unpacked
  before the first real store submission.
- Store-sized screenshots and the actual listing submission are still open
  — see `docs/08-store-listing.md`'s "Review readiness" section.

---
column: review
labels: [docs, infra]
priority: med
agent: sonnet
live: false
updatedAt: 2026-08-19T23:55:00.000Z
---
# Docs, launch script, and runtime requirements for native-only WebMCP

Native WebMCP goes from optional to **required**. Every doc that describes the
shim, the three compatibility modes, or the flag as a nice-to-have is now wrong.

Do this **last** — it documents what cards
[43](43-native-modelcontext-client.md)–[46](46-verify-harness-on-chrome-for-testing.md)
actually built. See [decisions/16](../../decisions/16-native-webmcp-client.md)
and [decisions/17](../../decisions/17-spec-annotations-and-untrusted-content.md).

## Scope

**`docs/02-webmcp-compatibility.md`** — near-total rewrite. The three-modes
framing (native / polyfilled / unsupported) collapses to one: native, or
nothing. Say plainly that polyfilled pages are invisible and that we no longer
provide an implementation to pages lacking one.

**`docs/01-architecture.md:40-180`** — the world diagram and "adopt-or-provide
shim" section describe deleted code. Replace with the single-content-script
picture: ISOLATED relay → worker → panel.

**`docs/04-troubleshooting.md:81-95`** — "A tab shows no tools" needs a third and
now most common cause: WebMCP is not enabled in this Chrome. Give the fix
(`chrome://flags/#enable-webmcp-testing`, or an origin-trial token on the site)
and explain how to tell it apart from a page that genuinely has no tools.

**`README.md:21-23, 33-41, 59-68`** — the "works regardless of native support"
claim is now false and must go. The flag moves from optional step 5 to a
hard requirement. Note the origin-trial alternative: a site carrying a WebMCP OT
token has the API without any flag, which is why
`googlechromelabs.github.io/webmcp-tools` demos work on a stock Chrome.

**`manifest.config.ts:12`** — raise `minimum_chrome_version` from `116`. Native
WebMCP is Chrome 149+ (origin trial runs 149–156). Adjust the justifying comment,
which currently cites `chrome.sidePanel` and `world: "MAIN"` — the latter is gone.

**`scripts/launch-chrome.mjs`** — it opens `chrome://flags/#enable-webmcp-testing`
on first run only (`:74`) and treats the flag as optional. Since nothing works
without it, detect and say so clearly every run. Keep the existing graceful
degradation if the flag id moves; the comment at `:67-73` is good and should
survive.

**Board hygiene** — `boards/project-backlog/18-iframe-tool-discovery.md` was
deferred because iframe tool identity had no defined semantics. The native API
now defines them: `registerTool`'s `exposedTo` and `getTools`'s `fromOrigins`,
with `RegisteredTool.origin` and `.window` identifying the source frame. Update
the card to reflect that the platform question is answered, without committing
to implementing it in this batch.

## Checklist

- [x] Rewrite `docs/02-webmcp-compatibility.md`
- [x] Rewrite the architecture/world sections of `docs/01-architecture.md`
- [x] Add the "WebMCP not enabled" cause to `docs/04-troubleshooting.md`
- [x] Correct README requirements and remove the compatibility claim
- [x] Raise `minimum_chrome_version` and fix its comment
- [x] Make the flag non-optional in `scripts/launch-chrome.mjs`
- [x] Update card 18 with the now-defined iframe semantics

## Comments

- **sonnet** (2026-08-19T23:30:00.000Z): Claimed the card. Read decisions/16, decisions/17, and the full `## Comments` journals of cards 42-46 to ground every doc claim in something actually built and verified (native `document.modelContext` client in `src/content/relay.ts`, spec-strict 2-field `ToolAnnotations` + untrusted fencing in `src/sidepanel/services/agentLoop.ts`, the demo rebuilt on the real API with 7 fixtures, `npm run verify` green 9/9 on Chrome for Testing with `--enable-features=WebMCP`). Confirmed current source state directly rather than trusting the card descriptions: `src/content/relay.ts:1-65` (ladder is relay `EXECUTE_TIMEOUT_MS=20_000` -> worker `CALL_TIMEOUT_MS=30_000`, docs/17), `src/sidepanel/services/agentLoop.ts:108-123` (panel's own `TOOL_CALL_TIMEOUT_MS=35_000`, outside the 2-layer ladder per card 30), `src/lib/protocol.ts:27-46` (`ToolAnnotations` is exactly `{readOnlyHint, untrustedContentHint}`), `src/sidepanel/components/ToolsPanel.svelte:13-40` (the shipped "WebMCP isn't available" copy naming `--enable-features=WebMCP` and `chrome://flags/#enable-webmcp-testing`). Starting with `docs/01-architecture.md`.
- **sonnet** (2026-08-19T23:55:00.000Z): Rewrote `docs/01-architecture.md` end to end — dropped the four-context diagram and the deleted MAIN-world bridge/"adopt-or-provide shim" section, replaced with a three-context picture (ISOLATED relay -> worker -> panel), a short note explaining what used to be there and why it's gone (pointing at decisions/16 and card 43's verified interop result), a rewritten "tool call end to end" walkthrough that includes decisions/17's untrusted-content fencing step, and a timeout-ladder section/table dropped from four rows to three (relay 20s -> worker 30s -> panel 35s outermost), keeping the "this regressed twice" history but reframed as "the old four-layer version." Session-ownership section left untouched (still accurate, out of this card's scope).
- **sonnet** (2026-08-19T23:56:00.000Z): Rewrote `docs/02-webmcp-compatibility.md` end to end — collapsed the native/polyfilled/unsupported three-modes framing to one supported case (native only), with explicit "What changed, and why" (citing the interop verification from card 43's journal: same 7-tool set as the official inspector), "What this costs" (polyfilled pages invisible, no-support pages no longer get an implementation — both stated plainly per the parent instruction), "Turning it on" (the three enablement paths from decisions/16: flag, `--enable-features=WebMCP`, OT token), and the origin-trial explanation for why `googlechromelabs.github.io/webmcp-tools` works on stock Chrome (decoded token `{"origin":"https://googlechromelabs.github.io:443","feature":"WebMCP","expiry":1794873600}`, supplied by the parent task). Added a "The WebMCP unavailable state" section describing the actual `available` boolean thread (relay -> protocol.ts -> sw.ts -> `PageInfo.webmcpAvailable` -> `ToolsPanel.svelte`), confirmed against `src/lib/protocol.ts:87-106` and `src/sidepanel/components/ToolsPanel.svelte:13-40` directly rather than from the card descriptions alone. Rewrote the iframe section to state the platform question is now answered (`exposedTo`/`fromOrigins`/`origin`/`window`) without claiming implementation.
- **sonnet** (2026-08-19T23:58:00.000Z): Added the "WebMCP not enabled" cause to `docs/04-troubleshooting.md`'s "A tab shows no tools" section (now three causes plus, separately, the accepted polyfill-invisibility limitation), matched to the actual shipped panel copy in `src/sidepanel/components/ToolsPanel.svelte:33-40`. Also updated the "tool call hangs" section's ladder description from four layers to three (relay/worker/panel) to match the docs/01 rewrite.
- **sonnet** (2026-08-19T23:59:00.000Z): Updated `README.md`: "What it does" bullet now describes reading native `document.modelContext` directly instead of "injects a bridge... regardless of native support"; `## Requirements` now states Chrome 149+ and that WebMCP itself must be enabled (three ways), with a pointer to the troubleshooting page instead of claiming the extension "works fully without any Chrome flag"; step 5 of "Build and load it" changed from "Optional" to "Required, not optional"; the demo-pages section rewritten to reflect the real 7-fixture set built on the actual native API (no more `late.html`/fake-polyfill mention, since card 45 deleted both); the "Launch it in real Chrome" and "Verification harness" sections rewritten to drop every reference to the deleted MAIN-world bridge, the "flag is optional" framing, and Playwright's bundled Chromium (verify now runs Chrome for Testing, per card 46); the Documentation list and the Project-status iframe bullet updated to match. Grepped for stragglers afterward (`destructiveHint`, `ToolSource`, stale `navigator.modelContext` mentions, `decisions/02`, `world: "MAIN"`, `116`) — all clear except historical/explanatory uses, which are correct to keep.
- **sonnet** (2026-08-20T00:00:00.000Z): `manifest.config.ts:13-20` — raised `minimum_chrome_version` from `116` to `149` (native WebMCP's minimum; the origin trial runs 149-156) and replaced the stale `chrome.sidePanel`/`world: "MAIN"` justification with one naming WebMCP as the binding constraint (`chrome.sidePanel`'s own minimum of 114 is below 149 anyway). Verified with `npm run build` — succeeds, and `dist/manifest.json` ships `"minimum_chrome_version": "149"`.
- **sonnet** (2026-08-20T00:02:00.000Z): `scripts/launch-chrome.mjs` — made the WebMCP requirement non-optional rather than just a documentation change: every launch now passes `--enable-features=WebMCP` on Chrome's command line directly (`WEBMCP_CHROME_ARG`, real branded Chrome does honour `--enable-features`, unlike `--load-extension`), removing the need for the manual chrome://flags step in the common case. Added a best-effort `isWebMcpFlagEnabledInProfile()` that reads the profile's `Local State` JSON for `browser.enabled_labs_experiments` (wrapped in try/catch, never fatal) so the script can print something more useful than "we don't know." The WebMCP status message is now printed on **every** run, not gated behind `isFirstRun` as before, worded as a hard requirement with the fallback path (manual flag toggle, or an OT-token-carrying site) spelled out. The first-run chrome://flags tab is kept open as the documented fallback, reworded from "optional" to "fallback, not the primary path." `node --check` passes; the header comment and the `WEBMCP_FLAGS_URL` construction/comment at the top (`:67-73` in the original) both survive per the parent instruction.
- **sonnet** (2026-08-20T00:03:00.000Z): Updated `boards/project-backlog/18-iframe-tool-discovery.md` per the board-hygiene note — added a dated update explaining the platform question (frame-qualified tool identity) is now answered by the native API's `exposedTo`/`fromOrigins`/`origin`/`window`, pointing at `src/content/relay.ts`'s existing use of `window` to scope its own top-frame lookups as a concrete example already in the codebase. Left `column: backlog` and did not commit to implementing it, per the parent instruction.
- **sonnet** (2026-08-20T00:04:00.000Z): Verification: `npm run build` succeeds (207 modules, `dist/manifest.json` confirmed at `minimum_chrome_version: "149"` and a single ISOLATED content script). `npm run check` — 164 files, 0 errors, 0 warnings; the two pre-existing redesign errors the parent flagged (`Transcript.svelte:183`, `App.svelte:191`) are no longer present, presumably resolved by the concurrent redesign work — not something this card touched or needed to fix. `node --check scripts/launch-chrome.mjs` passes. Did not touch `src/`, `demo/`, `verify/`, or `docs/03-privacy-and-trust.md` — confirmed via `git status` that only the seven files/docs in this card's scope changed. Moving to review.

**Summary for review:** rewrote `docs/01-architecture.md` (three-context picture, no bridge), `docs/02-webmcp-compatibility.md` (near-total rewrite: native-only, what it costs, how to turn WebMCP on, the unavailable-state), `docs/04-troubleshooting.md` (added the "WebMCP not enabled" cause), `README.md` (Requirements/build steps/demo/launch/verify/docs-list/project-status), `manifest.config.ts` (`minimum_chrome_version: "149"`), `scripts/launch-chrome.mjs` (always passes `--enable-features=WebMCP`, prints the requirement every run, keeps the manual flag tab as a fallback), and `boards/project-backlog/18-iframe-tool-discovery.md` (platform question answered, implementation still deferred). The main user-visible loss — polyfilled pages are now invisible, unsupported pages no longer get an implementation provided to them — is stated plainly in `docs/02-webmcp-compatibility.md` and `README.md`'s "What it does" bullet, not buried. Nothing in `src/`, `demo/`, or `verify/` was touched.

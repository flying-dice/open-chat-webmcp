# Chrome Web Store listing

This page is the working draft for the Chrome Web Store listing and its
Privacy practices tab — assembled from `public/_locales/en/messages.json`
(the strings Chrome itself renders), the README's capability list, and
`docs/03-privacy-and-trust.md` (the source of truth for every claim below;
nothing here should say more than that page proves). It is a draft to paste
into the Developer Dashboard, not a description of something already
submitted — see [Review readiness](#review-readiness) for what's still open.

## Name, summary, description

**Name** (from `extName`, `public/_locales/en/messages.json`):

> OpenChat (WebMCP)

**Summary** (the ≤132-character line shown in search results and the store
card; not a `_locales` string — Chrome has no separate slot for it, so this
is hand-written for the listing only):

> Chat with a local Ollama or any OpenAI-compatible model in a side panel —
> let it read the page or drive it through WebMCP, with your approval.

(118 characters.)

**Description** (long form; assembled from `extDescription` plus the
README's "What it does" section, condensed to prose a store visitor reads
top to bottom rather than a bulleted feature list):

> OpenChat puts a chat model in Chrome's side panel, next to any tab. Talk to
> a locally running Ollama server or any OpenAI-compatible endpoint — OpenAI
> itself, Azure OpenAI, OpenRouter, LM Studio, and others — by adding one or
> more providers on the options page.
>
> It works on every page, not only ones built for it. Select text and share
> it with your next message, or share a page's full text with one toggle —
> both only happen when you act, both show you exactly what's about to go
> with your message before it's sent, and both can be switched off per page
> with a single click that makes the assistant fully blind to that page: no
> tools, no text, nothing, until you switch it back on.
>
> On pages that publish WebMCP tools (document.modelContext) — the same
> native browser API any other WebMCP consumer reads — OpenChat can also let
> the model act on the page itself: filling forms, navigating, calling
> whatever the page has exposed. Every call that isn't explicitly marked
> read-only stops for your approval, showing the real arguments, before it
> runs. Remote MCP servers you register on the options page work the same
> way, merged into the same tool list under their own, stricter approval
> policy.
>
> Conversations are kept in a global, browsable history — a chat is its own
> thing, not tied to one tab — and the whole UI is available in ten
> languages (English, Simplified Chinese, Japanese, German, French, Spanish,
> Brazilian Portuguese, Korean, Russian, and Arabic with right-to-left
> layout).
>
> OpenChat has no telemetry, no crash reporting, no bundled backend, and no
> account system. It doesn't phone home. Every network request goes to a
> provider you configured, an MCP server you registered, or the page you're
> already on — nothing else. See the Privacy practices below and this
> project's [Privacy and trust](../docs/03-privacy-and-trust.md) page for the
> specifics, including what's stored locally and what a hostile page can and
> can't do through this extension.
>
> **Note on WebMCP tools:** native WebMCP (`document.modelContext`) ships
> behind a Chrome flag / origin trial through Chrome 156. Chat and
> page-sharing work on a completely stock Chrome install with nothing
> enabled; only page *tools* (the "let it act on the page" part) need WebMCP
> turned on. See [Review readiness](#review-readiness) below.

**Category**: **Productivity** — a side-panel chat tool that reads/acts on
whatever page you're on fits Chrome's Productivity category better than
Developer Tools; nothing about the listing pitch is developer-only (the
WebMCP flag caveat is a footnote, not the headline). Developer Tools is a
defensible second choice given WebMCP's current audience skews toward people
testing WebMCP-enabled sites — worth a final call by whoever files the
listing, not a hard requirement either way.

## Privacy practices disclosure

Chrome Web Store's Privacy practices tab asks for a single-purpose
description, a justification per requested permission, and a data-usage
certification. Field labels on the live dashboard can drift from what's
quoted here — verify wording at submission time — but the substance is
stable and every answer below is traceable to `docs/03-privacy-and-trust.md`
or `manifest.config.ts`.

**Single purpose**: Chat with a local or hosted language model in a side
panel, optionally letting it read the current page's shared text or call
tools the page (or a user-configured MCP server) publishes.

**Permission justifications** (every entry is reached for by name somewhere
in `src/` — `manifest.config.ts:48-51` re-checks this at every addition):

| Permission | Why it's requested |
| --- | --- |
| `sidePanel` | Opens the chat UI in Chrome's native side panel (`chrome.sidePanel.setPanelBehavior`, `src/background/sw.ts`) instead of a popup or a new tab — the extension's entire interface lives here. |
| `storage` | Persists chat history, provider/MCP-server configuration, and (unencrypted, `chrome.storage.local` only — never `chrome.storage.sync`) credentials, entirely on-device. See "What's stored" in [docs/03](03-privacy-and-trust.md). |
| `tabs` | Tracks which tab each side-panel instance is currently pointing at, and listens for navigation so the tool list stays in sync with the page being shown (`src/infra/chrome-runtime/tab-sync.ts`). Not used to read browsing history. |
| `identity` | `chrome.identity.launchWebAuthFlow`/`getRedirectURL` only, for OAuth 2.1 sign-in to an MCP server the user explicitly adds and enables (`decisions/27-oauth-for-http-mcp-servers.md`). Not Google/Chrome-account sign-in, not used for OpenChat's own account system — there isn't one. |
| `host_permissions`: `http://localhost/*`, `http://127.0.0.1/*` | Baked in (not runtime-granted) so a locally running Ollama, LM Studio, or llama.cpp server — the common case — needs no permission prompt. No other origin is pre-granted. |
| `optional_host_permissions`: `http://*/*`, `https://*/*` | Requested at runtime, one origin at a time, only when the user adds a cloud provider or a remote MCP server at that origin — triggered by a real click ("Test connection"/save), never granted in bulk or silently. |
| `content_scripts` (`<all_urls>`, `world: "ISOLATED"`, `document_start`) | The relay that reads a page's `document.modelContext` (WebMCP tools) and pulls selected/page text — but only on an explicit user gesture (selecting text, the panel pointing at the page, pressing Send), never in the background and never while the page's sharing gate is off. All URLs because WebMCP tools and page context are useful on any site, not a fixed list — the sharing gate, not the content-script match pattern, is the actual user-facing on/off control. |

**Data usage certification** — answered from [docs/03](03-privacy-and-trust.md)'s "No telemetry, no backend" and "What is not stored" sections:

- **Does the item collect or transmit user data itself (to the developer or any developer-operated service)?** No. There is no backend and no analytics/crash reporting of any kind (`docs/03-privacy-and-trust.md#no-telemetry-no-backend`).
- **Is data sold to third parties?** No — there's no data collection to sell in the first place.
- **Is data used for purposes unrelated to the extension's single purpose?** No.
- **Is data used to determine creditworthiness or for lending?** No.
- **What does leave the device, and where?** Only what the user explicitly configured receives it: (a) chat content and any shared page text/selection, sent to whichever provider (Ollama or an OpenAI-compatible endpoint) the user added, under that provider's own terms; (b) tool-call traffic to an MCP server the user registered and enabled; (c) WebMCP tool calls, which execute inside the page's own JavaScript context and never leave the browser via this extension at all. None of this is the extension's own developer or any third service chosen by the developer — every destination is one the user typed in.
- **Data stored on-device**: chat history (including tool-call arguments/results, which can contain whatever a page's tool exposes) and provider/MCP credentials, both unencrypted in `chrome.storage.local` — stated to the user in the options page next to the relevant fields, and disclosed in full in [docs/03](03-privacy-and-trust.md).

## Screenshots

Store screenshots come from `npm run verify`'s screenshot matrix
(gitignored `verify/output/screenshots/`, see the README's
[Verification harness](../README.md#verification-harness) section and
`verify/checks/screenshots.mjs`): 11 PNGs covering light/dark mode at the
side panel's 320px and 400px widths, the overflow menu, the model picker,
the activity timeline in all three of its states, and the options page in
both themes.

**Gap to close before submission**: those captures are sized to the side
panel's own width (320/400px), not the Chrome Web Store's screenshot
dimensions (1280×800 or 640×400, no more than 5, PNG/JPEG). None of the
harness's captures can be uploaded as-is — each intended screenshot needs
compositing into a browser-chrome mockup at a store-accepted size (the
`sidepanel-light.png`/`sidepanel-dark.png` pair already embedded in the
README, at `docs/images/`, are the closest existing assets to start from).
This is packaging/design work the harness doesn't produce automatically and
is not part of this card's script — flagged here so it isn't lost.

## Review readiness

- **The Chrome 156 WebMCP-flag caveat, stated plainly**: `minimum_chrome_version` is 149 (`manifest.config.ts:39-46`), and native WebMCP (`document.modelContext`) ships only behind `chrome://flags/#enable-webmcp-testing`, `--enable-features=WebMCP`, or a page's own origin-trial token, for the trial's 149–156 window. **Chat and page-context sharing (selected text, whole-page text) work on a completely stock Chrome with nothing enabled — WebMCP is not involved in either.** Only page *tools* (the model acting on a page through `document.modelContext`) need WebMCP turned on; without it the side panel reports WebMCP as unavailable rather than silently showing no tools (README's [Requirements](../README.md#requirements) section, corrected by card 120). This is worth restating explicitly in the listing description (done above) and, ideally, in the "What's new"/support text, since a reviewer or a store visitor who never turns on the flag will not see the tool-calling half of the extension and could otherwise read that as broken rather than as expected.
- **The origin-trial window itself is a ticking constraint**: WebMCP's trial runs through Chrome 156. Revisit this listing (and the caveat's wording) once WebMCP either ships stable or the trial is renewed — a public listing that still says "flag required" after WebMCP goes stable would be stale, not just imprecise.
- **Permissions**: every one justified above, each traceable to the exact call site that uses it (`manifest.config.ts:48-69`).
- **Privacy policy URL**: Chrome Web Store requires a reachable URL, not a repo-relative path. `docs/03-privacy-and-trust.md`'s GitHub blob URL is sufficient once the repository is public — no separate hosting needed; confirm the repo's visibility before filing the listing.
- **Support/homepage URL**: this repository's URL (README).
- **No remote code**: every script in the zip is what `npm run package` built and validated (see below) — no `eval`, no remotely fetched/executed JavaScript. WebMCP tool calls execute inside the page's *own* script, which is not code this extension ships or controls (`docs/03-privacy-and-trust.md`'s "No telemetry, no backend" section already makes this distinction for the data-usage answer above).
- **Icon/asset audit**: `manifest.icons`/`action.default_icon` declare 16/32/48/128px, all four files exist under `icons/` and their actual PNG dimensions match their declared size exactly, including the store-mandatory 128px — enforced every run by `scripts/package.mjs`'s icon validation, not just checked once by hand.
- **Package integrity**: `npm run package` (see the script's own header comment) produces `openchat-webmcp-<version>.zip` from a clean build, with the manifest verified at the zip root, every locale's `__MSG_*` keys verified resolvable, no source maps or dev-server artifacts in the bundle, and the version cross-checked against `package.json`. A failing validation exits non-zero with a specific reason — there is no path to a zip that hasn't passed all of them.
- **Open, not yet done**: no Chrome Web Store developer account has been used for this listing yet; store-sized screenshots (see above) and the promotional tile (optional, 440×280) don't exist yet; version/changelog discipline beyond `package.json`'s own version field is out of this card's scope.

## The signing model, and the one-time role of `dist.pem`

The Chrome Web Store signs the extension itself: every upload is a plain
zip, Google holds the signing key, and the store serves its own signed
CRX. The `dist.pem`/`dist.crx` pair from Chrome's local "Pack extension"
flow is a self-hosting mechanism — it is **never needed to publish or
update** a store listing.

Its one store-relevant property is the extension ID it encodes
(`iagjapmpoocifnklmcbkkocggnedaeea`, which is also the
`https://<id>.chromiumapp.org/` OAuth redirect origin any MCP
authorization servers may have been registered against). To make the
store listing adopt that same ID, the **first** upload — and only the
first — must contain the private key at the zip root:

    npm run package -- --key /path/to/dist.pem

Every subsequent upload is a plain `npm run package` zip. If a fresh
store-assigned ID is fine, skip the flag entirely.

**Where the key lives** (2026-08-23): Proton Pass, **Flying Dice** vault,
item **"OpenChat (WebMCP) — extension packing key (dist.pem)"** — the PEM
is the item's hidden `dist.pem` field, with the derived extension ID and
usage notes on the item itself. Retrieve it with:

    pass-cli item view --vault-name "Flying Dice" \
      --item-title "OpenChat (WebMCP) — extension packing key (dist.pem)"

It is not used by CI, is scrubbed by the clean build on every plain
`npm run package` run, and must never enter the repository.

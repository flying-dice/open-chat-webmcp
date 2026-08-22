# Troubleshooting

Most of these failures now surface **in the UI**, as a worded notice with a
concrete next step, rather than as a raw error string
(`boards/project-backlog/14-connection-diagnostics-and-empty-states.md`): each
provider client returns a specific, classified error for the failure modes it
can distinguish, the options page's "Test connection" button and the side
panel's provider picker render it, and a failed turn can offer a retry or an
open-options chip. This page is the ground truth on *mechanism* — what the
code actually distinguishes and what the real fix is — behind that copy.

## Ollama: connection fails with a generic error

This is almost always the CORS trap — read
[the README section on it](../README.md#the-ollama-cors-trap-read-this-first)
if you haven't. In short: Ollama rejects the extension's origin by default,
and a blocked CORS preflight and a genuinely dead server produce the
identical bare failure in `fetch()`, so **you cannot tell them apart from
the error alone**. The Ollama client's own error message
(`src/infra/ollama/client.ts`) states this explicitly and names the fix
(`OLLAMA_ORIGINS=chrome-extension://*`, restart the server) rather than
reporting a bare "network error", but it still can't tell you *which* of the
two is actually true. Check both:

1. Is Ollama actually running? `curl http://localhost:11434/api/tags` from a
   terminal (not the extension) — if this fails too, the server isn't up or
   isn't on the URL you configured.
2. If step 1 succeeds but the extension still fails, it's the CORS rejection
   — set `OLLAMA_ORIGINS` and restart Ollama.

## OpenAI-compatible: "Authentication failed (401)"

The API key is missing, wrong, or expired for the base URL configured. The
OpenAI client (`src/infra/openai/index.ts`) classifies HTTP 401/403
specifically as an `"auth"` error kind and words it this way rather than a
generic HTTP failure — check the key in the options page's provider form.

## OpenAI-compatible: host permission prompt / "permission needed"

Any provider base URL other than `localhost`/`127.0.0.1` needs a Chrome host
permission the extension doesn't ship by default
(`optional_host_permissions` in `manifest.config.ts`,
`decisions/09-provider-agnostic-chat-transport.md`). The options page
requests this via `chrome.permissions.request` from the "Test connection"
button's own click handler — it has to be a direct result of a user gesture,
which is why it isn't requested automatically in the background. If you
declined the prompt, or it never appeared, re-click Test Connection to
trigger it again; the provider row shows a live "Permission needed" /
"Permission granted" badge (`src/options/components/ProviderRow.svelte`)
reflecting the actual current grant.

## No models listed for a provider

For Ollama, this means `ollama list` is empty on the box the base URL points
at — pull a model, e.g. `ollama pull qwen3`. For an OpenAI-compatible
provider without a working `/v1/models` endpoint, the client falls back to a
user-entered model id rather than a live list; there's no automatic
discovery to fall back to in that case.

## Models are listed but all disabled ("no tool-calling support" / "tool support not verified")

The picker never hides a model — every installed/known model is listed, but
one that can't (or isn't confirmed to be able to) drive page tools is shown
disabled with an inline reason, rather than silently producing a chat that
ignores every WebMCP tool and looks broken
(`decisions/06-tool-capable-models-only.md`, generalized by
`decisions/11-provider-capability-detection.md`):

- **"no tool-calling support"** — confirmed, via Ollama's live `/api/show`
  capability query. Pull a different, tool-capable model.
- **"tool support not verified for this model"** — OpenAI's API has no
  per-model capability query, so the client checks a maintained static
  allowlist of known tool-calling model IDs. A model not on that list gets
  this "unknown" state rather than being guessed either way. If you believe
  the model genuinely supports tool calling, this is the allowlist being out
  of date (`src/infra/openai/index.ts`), not a configuration problem on
  your end — there is currently no user-facing override to force it on.

## A tab shows no tools / "no relay in this tab"

Three different situations produce this, and telling them apart matters —
they have three different (non-)fixes.

- **WebMCP is not enabled in this Chrome.** This is the most common cause
  today, and the one most likely to be mistaken for a genuine bug, because
  native WebMCP is now a hard requirement
  ([decisions/16](../decisions/16-native-webmcp-client.md)) but ships off by
  default. The panel tells these two apart explicitly: if
  `document.modelContext` doesn't exist in the tab at all, the tools view
  shows a distinct **"WebMCP isn't available in this browser (or on this
  page)"** message (`src/sidepanel/components/ToolsPanel.svelte`) rather than
  the ordinary "this page has no tools" empty state — if you're seeing the
  ordinary empty state, WebMCP itself is working and the page really just has
  no tools; if you're seeing the "unavailable" message, fix it one of three
  ways:
  1. Turn on `chrome://flags/#enable-webmcp-testing` ("WebMCP for testing")
     and relaunch Chrome. `npm run launch` opens this page for you on first
     run.
  2. Launch Chrome with `--enable-features=WebMCP`.
  3. Visit a page carrying a WebMCP origin-trial token — these work without
     any flag at all. See
     [docs/02-webmcp-compatibility.md](02-webmcp-compatibility.md#turning-it-on)
     for why Google's own `googlechromelabs.github.io/webmcp-tools` demos
     work on a stock Chrome while a local page doesn't: the demo pages carry
     a token scoped to that origin, nothing about your setup is missing.
  Also check that the extension itself is built against a new enough
  `minimum_chrome_version` (`manifest.config.ts`) — WebMCP requires
  Chrome 149+.
- **The page genuinely publishes no WebMCP tools.** The overwhelming
  majority of sites, even with WebMCP enabled — this isn't an error, the
  model just has nothing to call and answers from its own knowledge. See
  [docs/02-webmcp-compatibility.md](02-webmcp-compatibility.md).
- **The page is one Chrome doesn't allow content scripts on at all** —
  `chrome://` pages, the Chrome Web Store, the built-in PDF viewer, and
  similar restricted surfaces. No content script means no relay in that tab,
  which the service worker reports back as an explicit "no relay in this
  tab" error (`src/background/sw.ts`) rather than a silent empty tool list.
  There is no way to make WebMCP tools work on these pages — it's a Chrome
  platform restriction, not something this extension can route around.
- **A page relying on a JS polyfill instead of native support.** As of
  [decisions/16](../decisions/16-native-webmcp-client.md) this extension only
  reads `document.modelContext` from the ISOLATED world, so a polyfill that
  installs its implementation in the page's own MAIN world (e.g.
  `@mcp-b/global`) is invisible to us — this looks identical to "page
  publishes no tools" from the panel's side, since there's no separate signal
  for "a polyfill is here but we can't see it." See
  [docs/02-webmcp-compatibility.md](02-webmcp-compatibility.md) for why this
  is accepted, not a bug.

## A tool call hangs, or its error looks generic instead of specific

Tool calls pass through three layers (panel → worker → relay, with the
relay calling `document.modelContext.executeTool()` directly; see
[docs/01-architecture.md](01-architecture.md#the-timeout-ladder)), each with
its own timeout, deliberately laddered innermost-shortest (relay 20s < worker
30s < panel 35s) so the most specific error — the one from the layer
actually next to the native `executeTool` call — is the one that reaches
you. If you see a generic "tool call timed out" / "tab did not respond in
time" message instead of one naming the actual tool, that ladder has
regressed (it has happened twice before, on the older four-layer version of
it — `boards/project-backlog/28-fix-inverted-tool-call-timeout-ladder.md`,
`boards/project-backlog/30-panel-timeout-outside-ladder.md`) and is worth
filing as a bug rather than working around. All three rungs are now declared
once, in `src/infra/webmcp/timeouts.mjs`, and `npm run verify` asserts the
innermost one end to end against that same constant.

## Closing the panel mid-reply loses the rest of the answer

Expected, not a bug: the side panel owns the HTTP connection to the
provider directly, and the request is tied to the panel's lifetime via an
`AbortController` (`decisions/01-side-panel-as-primary-ui.md`,
`decisions/09-provider-agnostic-chat-transport.md`). Whatever had already
streamed in is kept in the persisted session; the rest of the generation is
simply not recoverable — reopening the panel shows the partial reply, not a
continuation of it.

## Switching provider/model mid-conversation looks fine, then loses messages later

This was a real bug, fixed — `boards/project-backlog/29-selection-store-stale-session-write.md`
and [docs/01-architecture.md](01-architecture.md#session-ownership-one-chat-one-owner).
If you observe the symptom (conversation looks right until the panel is
closed and reopened, then some messages are missing) on the current code,
that fix has regressed — it isn't a known, accepted limitation like the two
above.

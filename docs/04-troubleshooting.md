# Troubleshooting

There is **no dedicated in-app diagnostics UI yet** — that's
`boards/project-backlog/14-connection-diagnostics-and-empty-states.md`,
still in the backlog. What exists today is: each provider client returns a
specific, worded error for the failure modes it can distinguish, and the
options page's "Test connection" button and the side panel's provider picker
surface that text. This page collects the failure modes that genuinely exist
in the code right now, and their real fixes. Once card 14 lands, expect this
page to be largely superseded by whatever the in-UI empty states end up
saying — treat this as the ground truth on *mechanism*, not as a preview of
that UI's copy.

## Ollama: connection fails with a generic error

This is almost always the CORS trap — read
[the README section on it](../README.md#the-ollama-cors-trap-read-this-first)
if you haven't. In short: Ollama rejects the extension's origin by default,
and a blocked CORS preflight and a genuinely dead server produce the
identical bare failure in `fetch()`, so **you cannot tell them apart from
the error alone**. The Ollama client's own error message
(`src/lib/ollama.ts`) states this explicitly and names the fix
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
OpenAI client (`src/lib/providers/openai.ts`) classifies HTTP 401/403
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
  of date (`src/lib/providers/openai.ts`), not a configuration problem on
  your end — there is currently no user-facing override to force it on.

## A tab shows no tools / "no relay in this tab"

Two different situations produce this:

- **The page genuinely publishes no WebMCP tools.** The overwhelming
  majority of sites — this isn't an error, the model just has nothing to
  call and answers from its own knowledge. See
  [docs/02-webmcp-compatibility.md](02-webmcp-compatibility.md).
- **The page is one Chrome doesn't allow content scripts on at all** —
  `chrome://` pages, the Chrome Web Store, the built-in PDF viewer, and
  similar restricted surfaces. No content script means no relay in that tab,
  which the service worker reports back as an explicit "no relay in this
  tab" error (`src/background/sw.ts`) rather than a silent empty tool list.
  There is no way to make WebMCP tools work on these pages — it's a Chrome
  platform restriction, not something this extension can route around.

## A tool call hangs, or its error looks generic instead of specific

Tool calls pass through four layers (panel → worker → relay → bridge; see
[docs/01-architecture.md](01-architecture.md#the-four-rung-timeout-ladder)),
each with its own timeout, deliberately laddered innermost-shortest (bridge
20s < relay 25s < worker 30s < panel 35s) so the most specific error — the
one from the layer actually next to the page's `execute` call — is the one
that reaches you. If you see a generic "tool call timed out" / "tab did not
respond in time" message instead of one naming the actual tool, that ladder
has regressed (it has happened twice before —
`boards/project-backlog/28-fix-inverted-tool-call-timeout-ladder.md`,
`boards/project-backlog/30-panel-timeout-outside-ladder.md`) and is worth
filing as a bug rather than working around.

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
and [docs/01-architecture.md](01-architecture.md#session-ownership-one-chatsession-one-owner).
If you observe the symptom (conversation looks right until the panel is
closed and reopened, then some messages are missing) on the current code,
that fix has regressed — it isn't a known, accepted limitation like the two
above.

# Privacy and trust

This page states plainly what this extension stores, where, and what it does
and doesn't protect you from. Nothing here is designed to alarm or to
reassure — it's what's actually implemented, cited to the code and the
decision records that explain why.

## Conversation history is stored unencrypted, and it can contain page content

Every chat session — one per tab — is written to `chrome.storage.local`
**unencrypted**, debounced during streaming and flushed on unload
(`src/lib/session.ts`, `decisions/07-session-state-and-persistence.md`).
That history includes:

- Everything you typed.
- Everything the model replied.
- **Every tool call's arguments and result.** If a page's tool reads
  authenticated account data, order history, private messages — anything
  visible to you as a logged-in user on that site — and the model calls that
  tool, the result becomes part of the stored conversation, in plain text,
  on disk.

There is no encryption-at-rest for this data and no opt-out of storing it
short of using **Clear history** (options page) or not using the extension
on sites carrying data you don't want retained. Sessions are capped (oldest
evicted first) but not automatically deleted on any particular schedule.

Anyone with local filesystem access to your Chrome profile (another OS user
account with access, malware, physical access to an unlocked machine) can
read this the same way they could read any other unencrypted local browser
storage.

## API keys are stored unencrypted, kept out of sync storage deliberately

Each provider's API key (OpenAI-compatible providers; Ollama doesn't use
one) is stored **unencrypted** in `chrome.storage.local`, keyed by provider
id — never in `chrome.storage.sync`
(`decisions/10-provider-registry-and-credential-storage.md`). This is a
deliberate choice, not an oversight: `chrome.storage.sync` propagates to
every Chrome profile signed into the same Google account, and a credential
syncing to a second machine or profile the user didn't explicitly intend to
hand it to is a worse outcome than requiring it to be re-entered there. The
trade-off is explicit: a freshly signed-in profile has to re-enter every
provider's key from scratch, because none of them ever left the machine they
were entered on.

The options page states this next to the API key field, not just here.

## Tool annotations are the page's own claims, not a security boundary

WebMCP tool descriptors can carry `annotations.readOnlyHint` and
`annotations.destructiveHint`. This extension uses `readOnlyHint === true` to
decide whether a call runs automatically or requires your explicit approval
(`decisions/05-tool-approval-policy.md`) — but that hint is **supplied by the
page itself**, over a channel this extension does not and cannot verify. A
hostile or buggy page can label a tool that deletes your data as
`readOnlyHint: true`, and the extension has no way to know that's a lie
before the call runs.

This is why every non-read-only call (and every call whose page provides no
annotations at all — absence is treated as mutating, never as safe) stops
for a human approval card showing the actual arguments before anything runs.
That pause — a human looking at real arguments before a real call — is the
actual security boundary. The annotation-driven auto-run/require-approval
split is a **UX convenience** for keeping the common read-heavy case fluid,
not a safety mechanism, and both the approval card and the collapsed
auto-run tool card word it that way in the UI itself
(`src/sidepanel/components/ApprovalCard.svelte`,
`src/sidepanel/components/ToolCallCard.svelte`) rather than presenting a
"verified safe" badge.

The real boundary this extension relies on is narrower and behavioral: *you*
chose to open the side panel on this specific tab. It never runs against a
page you haven't opened it on.

## No telemetry, no backend

The extension has no analytics, crash reporting, or usage tracking of its
own, and ships no backend service — there is nothing this project's authors
operate that your data passes through. Every network request the extension
makes goes to a provider you explicitly configured (a local Ollama server or
an OpenAI-compatible endpoint you supplied the base URL and key for) or to
the page you're already on (WebMCP tool calls execute in that page's own
JavaScript context, same-origin, with that page's own privileges — see
[docs/01-architecture.md](01-architecture.md)). If you run Ollama locally and
never configure a cloud provider, no chat content leaves your machine at
all; if you configure a cloud provider, your conversation (including tool
call results, per above) goes to whatever endpoint you pointed it at, under
whatever privacy terms that provider offers — this extension has no
visibility into or control over what that provider does with it afterward.

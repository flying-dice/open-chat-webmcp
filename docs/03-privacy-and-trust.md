# Privacy and trust

This page states plainly what this extension stores, where, and what it does
and doesn't protect you from. Nothing here is designed to alarm or to
reassure — it's what's actually implemented, cited to the code and the
decision records that explain why.

## The rule: only what you visibly share

Until `decisions/40-page-context-access.md`, this extension could only see
what a page chose to *publish* as WebMCP tools. It can now also read the page
itself — the text you have selected, and (when you ask for it) an extraction
of the page's visible text. That is a real widening of what the extension can
see, so it comes with one rule that the code is built around:

> **Nothing leaves the page without a user-visible artifact, before and
> after.** Before: a chip on the composer showing exactly what is about to go
> with your message. After: a marker on that message in the transcript
> recording what went with it.

There is no background reading. The two page-reading messages in the
extension's protocol are *pull only* — no message in it can carry page text
anywhere except in answer to a request the panel made
(`src/infra/chrome-runtime/protocol.ts`), and the domain port that pulls one
has no `subscribe` method to call (`PageContextSource`,
`src/domain/chat/page-context.ts`). A page read happens on exactly four
things, all of them yours: selecting text on the page, clicking into the
panel, the panel starting to point at a different page, and pressing Send.
Nothing polls, and nothing streams.

**Selecting text updates the chip as you go.** While sharing is on, the page
tells the extension that your selection has changed — and nothing else: that
message carries no text, not even how much of it there is
(`runtime:selection-changed`, `src/content/relay.ts`). The panel answers it by
making the same gated read it makes when you click into it, so the chip above
the composer keeps up with what you have highlighted without you having to
touch the panel first. The text still goes exactly one place, the chip, and
still leaves for the model only with the message you choose to send. With
sharing dismissed the notice is dropped and no read is made at all. Very short
selections — one or two characters — are treated as no selection at all
(`MIN_SELECTION_CHARS`, `src/infra/dom/page-extraction.ts`), so an accidental
double-click never quietly becomes something you sent.

### The sharing gate

The context strip above the composer — the one that says
"Sharing *page name* · N tools" — is a **consent control, not a label**. Its
✕ ("Stop sharing this page") makes the assistant fully blind to that page:

- its tools disappear from the tools panel, from every count in the UI, and
  are never attached to a turn;
- no selection or page text can be pulled at all — the port is not called;
- the strip changes to "Not sharing this page" with an equally visible
  "Share this page" button to undo it.

The gate is enforced in two independent places on purpose. The side panel
refuses to pull or attach anything while it is down
(`src/sidepanel/stores/pageSharing.svelte.ts`), and the turn engine itself
refuses to look up the page's tools or put any page text in the prompt
regardless of what it was handed (`src/domain/chat/turn.ts`,
`src/domain/chat/service.ts`). A consent gate enforced only in the UI is a
promise about one caller's discipline; enforced in the domain it is a property
of running a turn at all.

**Scope of a dismissal**: per tab, per origin, in memory. Navigating to a
different site turns sharing back on (a dismissal is a judgement about *this
page*, not a site blocklist you never asked to create); a different tab is
unaffected; and closing the panel resets everything to the sharing-on default.
Nothing about the gate is written to storage.

**Restricted pages are unchanged.** On `chrome://` URLs, the Chrome Web Store,
the built-in PDF viewer and anywhere else Chrome refuses to run a content
script, there is no relay and nothing to withhold; the strip says so and
offers no gate controls at all.

### What the model is actually sent

Shared page text is **untrusted input** and is treated exactly like a tool
result (`decisions/17-spec-annotations-and-untrusted-content.md`): wrapped in
an explicit `<<<UNTRUSTED_TOOL_RESULT>>>` / `<<<END_UNTRUSTED_TOOL_RESULT>>>`
fence with a preamble stating that a web page wrote it, that it is data and
never instructions, which page it came from, and — when it stopped at the
16 KB extraction cap — that the model has *not* been shown all of it. Our own
fence markers are stripped out of the page's text before it goes in, so a page
that includes them in its own content cannot close the fence early and have
what follows read as though it were trusted
(`neutralizeFenceMarkers`, `src/domain/chat/message.ts`).

This is defence in depth, not a hard boundary. A sufficiently clever page can
still write text that talks a model into something, which is why the fence is
paired with a standing instruction in the system prompt rather than relied on
alone — and why every tool call that could *act* on your behalf still stops
for the approval card described below.

### What is not stored

The shared text itself is **never written to disk**. The transcript records
only that something was shared — `{kind: "page-selection" | "page-content",
truncated: boolean}` (`SharedContextMarker`, `src/domain/chat/message.ts`) —
so a page's content cannot outlive the conversation it was shared with. The
text of your selection is, of course, part of the request that went to your
model provider, and if that provider is a cloud one, that is where it went.

### The one thing that keeps working while sharing is off

The background worker keeps a local registry of which tools each tab has
published, refreshed as tabs navigate. That cache is *not* cleared by
dismissing sharing — but while sharing is dismissed nothing from it reaches
the model or the UI: the tools are not offered to a turn, not listed, and not
counted. It is local discovery bookkeeping, not content, and it never leaves
your machine either way.

## Conversation history is stored unencrypted, and it can contain page content

Every chat is written to `chrome.storage.local` **unencrypted**, debounced
during streaming and flushed on unload
(`src/infra/chrome-storage/chat-store.ts`,
`decisions/07-session-state-and-persistence.md` as revised by
`decisions/13-global-tab-aware-chat-history.md` — a chat is its own thing with
its own id, listed globally; a tab holds a soft pointer to whichever chat it
is currently showing). That history includes:

- Everything you typed.
- Everything the model replied.
- **Every tool call's arguments and result.** If a page's tool reads
  authenticated account data, order history, private messages — anything
  visible to you as a logged-in user on that site — and the model calls that
  tool, the result becomes part of the stored conversation, in plain text,
  on disk.
- **Not** the page text or selection you shared with a turn — only a marker
  saying that you shared one (see above). That text reached your model
  provider, but it is not in the stored transcript.

There is no encryption-at-rest for this data and no opt-out of storing it
short of deleting individual chats (the side panel's History view), using
**Clear history** (options page), or not using the extension on sites carrying
data you don't want retained. Deletion is the intended way chats go away;
there is also a backstop cap of 400 retained chats (`MAX_RETAINED_CHATS`,
`src/domain/chat/session.ts`) that evicts the oldest by `updatedAt`, so
storage stays bounded for a user who never deletes anything. Nothing is
deleted on a schedule.

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

The same split covers every other credential the extension holds: a
provider's custom request **header values**
(`decisions/15-custom-headers-are-credentials.md` — a header value is a
credential by default), and, for each registered MCP server, its bearer token
or its OAuth 2.1 access/refresh tokens
(`decisions/27-oauth-for-http-mcp-servers.md`). All of them live in
`chrome.storage.local` under a per-id key, written by exactly one module
(`src/infra/chrome-storage/keyed-record-store.ts`), and structurally cannot
reach the sync area: only the non-credential "core" of a provider or server
record — name, URL, type, enabled flag — is ever synced.

The options page states this next to the API key and bearer-token fields, not
just here.

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
`src/sidepanel/components/ToolCallRow.svelte`) rather than presenting a
"verified safe" badge.

The real boundary this extension relies on is narrower and behavioral: *you*
chose to open the side panel on this specific tab, and — since
`decisions/40-page-context-access.md` — you can withdraw that on any page with
one click. It never runs against a page you haven't opened it on, and never
reads a page you have told it to stop sharing.

## No telemetry, no backend

The extension has no analytics, crash reporting, or usage tracking of its
own, and ships no backend service — there is nothing this project's authors
operate that your data passes through. Every network request the extension
makes goes to a provider you explicitly configured (a local Ollama server or
an OpenAI-compatible endpoint you supplied the base URL and key for), to an
MCP server you explicitly registered and enabled (plus, during sign-in, that
server's own advertised OAuth authorization server), or to
the page you're already on (WebMCP tool calls execute in that page's own
JavaScript context, same-origin, with that page's own privileges — see
[docs/01-architecture.md](01-architecture.md)). If you run Ollama locally and
never configure a cloud provider, no chat content leaves your machine at
all; if you configure a cloud provider, your conversation (including tool
call results and any page text you shared, per above) goes to whatever
endpoint you pointed it at, under whatever privacy terms that provider offers
— this extension has no visibility into or control over what that provider
does with it afterward.

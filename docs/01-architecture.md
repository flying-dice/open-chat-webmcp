# Architecture

The extension is split across three separate JavaScript execution contexts
that cannot see each other's variables and can only talk over explicit
message-passing. This split is invisible from the file tree unless you
already know MV3, so this page exists to make it explicit.

```
┌──────────────────────────────┐
│  ISOLATED-world relay          │
│  src/content/relay.ts          │
│  runs alongside the page,      │
│  reads document.modelContext   │
│  DIRECTLY (a real Document-    │
│  scoped IDL attribute — visible│
│  from ISOLATED even though the │
│  page registered tools in its  │
│  own MAIN world)               │
└───────────────┬────────────────┘
                │ chrome.runtime.sendMessage / onMessage
                ▼
┌──────────────────────────────┐
│  Service worker (background)   │
│  src/background/sw.ts          │
│  per-tab tool registry,        │
│  message broker only —         │
│  never talks to a chat         │
│  backend itself                │
└───────────────┬────────────────┘
                │ chrome.runtime messaging
                ▼
┌──────────────────────────────┐
│  Side panel                    │
│  src/sidepanel/**               │
│  owns the HTTP/streaming        │
│  connection to the active       │
│  provider directly; the sole    │
│  in-memory ChatSession owner    │
└──────────────────────────────┘
```

There used to be a fourth context: a MAIN-world bridge
(`src/inject/bridge.ts`) that installed an "adopt-or-provide" shim on
`navigator.modelContext` so the extension could discover tools regardless of
whether the browser itself, a polyfill, or neither implemented WebMCP. It is
**deleted**. See [decisions/16](../decisions/16-native-webmcp-client.md) for
why: the premise that discovery required injecting into the page's own JS
world turned out to be wrong — `document.modelContext` is a genuine
`Document`-scoped IDL attribute, so the ISOLATED-world relay can read it
directly, with no MAIN-world script needed at all. The practical trade this
bought: the extension is now interoperable with the WebMCP ecosystem (the
official inspector extension and this extension see the identical tool set on
the same page — verified, see card
[43](../boards/project-backlog/43-native-modelcontext-client.md)'s journal),
at the cost of no longer working on a browser without native WebMCP support.
See [Compatibility](02-webmcp-compatibility.md) for what that trade means in
practice.

## The three contexts

### 1. ISOLATED-world relay — `src/content/relay.ts`

Injected at `document_start`, in the default ISOLATED world, into every page
(`content_scripts` in `manifest.config.ts`) — but into the **top frame only**
(`all_frames: false`; see [Compatibility](02-webmcp-compatibility.md#out-of-scope-iframes)).
It talks to `document.modelContext` directly, no bridge in between:

- **Discovery**: `await document.modelContext.getTools()`. Tools are scoped
  to `t.window === window` (mirroring the official inspector) so a tool
  registered by a subframe can't shadow a same-named top-frame tool, even
  though `getTools()` can return entries from other frames on the page.
- **Live updates**: `document.modelContext.ontoolchange` fires on both
  registration and abort-driven unregistration; the relay debounces it
  ~100ms (`TOOLCHANGE_DEBOUNCE_MS`) before re-fetching and pushing an updated
  list to the service worker as `runtime:tools-updated`.
- **Invocation**: `executeTool(tool, input)`, called on the tool `object`
  returned by `getTools()` — not by name. The worker calls tools by name, so
  the relay keeps the live objects from the last `getTools()` around and
  resolves name → object itself, re-fetching once on a cache miss before
  reporting "Unknown tool".
- **Availability**: read once at module load
  (`document.modelContext !== undefined`) rather than polled, since an
  origin-trial token is evaluated at parse time and doesn't change mid-page.
  This produces a distinct `available: boolean` that's threaded all the way
  to the panel — see
  [Compatibility](02-webmcp-compatibility.md#the-webmcp-unavailable-state).

Chrome's shipped behaviour disagrees with the published WebMCP spec IDL in
several places that will bite anyone modifying this file — see
[decisions/16](../decisions/16-native-webmcp-client.md#context) for the full,
measured list. Two worth knowing up front:

- `RegisteredTool.inputSchema` is a **JSON string**, not an object — the
  relay `JSON.parse`s it defensively before it reaches `SerializedTool`.
- `executeTool`'s second argument is **mid-migration in Chrome itself**: the
  official inspector tries the object form first and falls back to a
  JSON-string form only on the exact error `"Failed to parse input"`,
  carrying a TODO to drop the fallback once Chrome Stable stops accepting a
  string. The relay's `callExecuteTool` (`src/content/relay.ts`) mirrors that
  same try/fallback shape rather than hardcoding either form, so this file
  doesn't silently break when Chrome finishes the migration.

One easy mistake, hit and fixed while building the verify harness (card 46's
journal): detaching `document.modelContext.executeTool` into a bare function
reference before calling it drops the `this` binding a native WebIDL method
requires and throws `Illegal invocation`. It must be called as
`mc.executeTool.call(mc, ...)` (or through `mc.executeTool(...)` directly),
never as a standalone reference.

### 2. Service worker — `src/background/sw.ts`

The MV3 background service worker. Deliberately small
(`decisions/04-ollama-transport.md`, generalized by
`decisions/09-provider-agnostic-chat-transport.md`): it never talks to
Ollama, OpenAI, or any chat backend. Its three jobs:

- `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` —
  the toolbar icon opens the panel directly, no popup.
- Holds the **authoritative per-tab tool registry**, a `Map<tabId, {origin,
  tools, available}>`, updated from the relay's `runtime:tools-updated`
  pushes and cleared on `chrome.tabs.onUpdated` (navigation) and
  `chrome.tabs.onRemoved` (tab close) — see
  `decisions/07-session-state-and-persistence.md`. The `available` flag
  (added by [decisions/16](../decisions/16-native-webmcp-client.md)) carries
  whether `document.modelContext` exists in that tab at all, distinct from a
  page genuinely publishing zero tools.
- Brokers tool calls: relays `runtime:call-tool` from the panel to the right
  tab's relay and returns the result, and reports a clear, specific error
  ("no relay in this tab") for pages a content script can't run on at all —
  `chrome://` pages, the Web Store, the PDF viewer.

Because MV3 service workers are killed after ~30s idle, the in-memory
registry can be wiped at any time. Nothing treats that as fatal: a cache miss
falls back to a live pull from the tab's relay (`runtime:refresh-tools`), so
the registry self-heals after a restart instead of silently reporting zero
tools. This recovery path is exercised directly by `npm run verify` (card
46's journal: "Registry recovers after the MV3 service worker is killed").

### 3. Side panel — `src/sidepanel/**`

A Svelte 5 app that is the *only* chat surface (no popup, no injected
in-page UI — `decisions/01-side-panel-as-primary-ui.md`). It owns the
HTTP/streaming connection to whichever provider is active, directly — the
service worker is not in that path at all
(`decisions/09-provider-agnostic-chat-transport.md`, generalizing the
Ollama-only version of this in `decisions/04-ollama-transport.md`). It asks
the service worker for the current tab's tools and routes tool calls through
it, but the token stream itself goes straight from the provider's HTTP
response into the UI.

Consequence worth knowing: **closing the side panel aborts any in-flight
generation.** The request is tied to the panel's lifetime via an
`AbortController`; there is no mechanism to keep it going in the background.

## A tool call, end to end

1. User sends a message. `src/sidepanel/services/agentLoop.ts` builds ONE
   merged tool list — the active tab's page tools plus every enabled MCP
   server's currently-cached tools, namespaced `<serverSlug>__<toolName>`
   so a server tool can never collide with a page tool or another server's
   ([decisions/19](../decisions/19-merging-server-tools-with-page-tools.md))
   — and sends it, plus the conversation, to the active provider's `chat()`,
   streaming the reply into the transcript. Server tool discovery
   (`src/sidepanel/services/mcpTools.ts`) runs in the background and is
   never awaited on this critical path: a slow, dead, unauthenticated, or
   not-yet-permitted server simply contributes no tools this turn.
2. The model's response includes a `tool_calls` entry. The agent loop
   resolves the requested name back to its merged entry and applies THAT
   entry's own source's policy — a page tool by the unchanged decisions/05/17
   rule (`annotations.readOnlyHint === true` runs immediately; anything else,
   including no annotations at all, blocks on an approve/deny card), a
   server tool by its own, separate, stricter
   [decisions/20](../decisions/20-approval-policy-is-per-tool-source.md)
   rule (default: every server call blocks on approval regardless of
   `readOnlyHint`). The two policies share no decision logic and are
   configured independently on the options page.
3. Once cleared to run, a PAGE tool call goes through the worker/relay hops
   below; a SERVER tool call instead goes straight out over HTTP via
   `src/lib/mcp/client.ts`'s `callServerTool`. `executeToolCall` itself never
   branches on which kind it's calling — it just invokes whichever executor
   the merged entry already carries.
4. **Page tools only:** the panel sends `runtime:call-tool` to the service
   worker, which looks up which tab owns the session and forwards the call
   to that tab's relay over `chrome.runtime` messaging.
5. **Page tools only:** the relay resolves the tool by name against its
   cached `getTools()` objects and calls
   `document.modelContext.executeTool(tool, input)` directly — no further
   hop into the page.
6. The result travels back to the panel — for a page tool, an MCP-shaped
   `{ content: [...] }` or `{ isError: true }` from relay → service worker →
   panel; for a server tool, `callServerTool`'s own result, straight back to
   the panel. A page tool's result is fenced only if
   `annotations.untrustedContentHint === true`; a SERVER tool's result is
   ALWAYS fenced, regardless of what (if anything) the server said — MCP has
   no equivalent hint, so absence is never read as "trusted" (decisions/19
   §3). Fencing wraps the result in an explicit delimiter before it re-enters
   the model's context (see
   [decisions/17](../decisions/17-spec-annotations-and-untrusted-content.md));
   the transcript also marks such results visibly and states WHERE the call
   ran (decisions/19 §6) on every surface that names it — the tools list, the
   approval card, and the call log. The panel appends the (unfenced) result
   as a `role: "tool"` message and the loop continues until the model stops
   calling tools or an 8-iteration cap trips.

## The timeout ladder

A tool call passes through two layers before a result (or timeout) reaches
the relay's own `executeTool` call, and a third layer — the panel — sits
outside that as the overall UI budget: **relay → worker**, with the **panel**
watching the whole round trip from outside. Each layer sets its own timeout,
ordered **innermost-shortest**:

| Layer | Constant | Value | File |
|---|---|---|---|
| Relay (innermost) | `EXECUTE_TIMEOUT_MS` | 20s | `src/content/relay.ts` |
| Service worker | `CALL_TIMEOUT_MS` | 30s | `src/background/sw.ts` |
| Side panel (outermost) | `TOOL_CALL_TIMEOUT_MS` | 35s | `src/sidepanel/services/agentLoop.ts` |

[decisions/16](../decisions/16-native-webmcp-client.md) deleted the ladder's
former innermost rung: the MAIN-world bridge used to own execution and set
its own 20s `EXECUTE_TIMEOUT_MS`. The relay now owns execution directly
against `document.modelContext.executeTool()` and inherited that same 20s
budget and constant name, one layer further out than before. The ladder is
two layers deep now (relay → worker), plus the panel's own outer budget,
rather than the original four (bridge → relay → worker → panel).

The reasoning for keeping budgets ordered innermost-shortest is unchanged:
the relay is the layer closest to the actual `executeTool` call and can
produce a specific, useful error ("Timed out after 20000ms running the
tool."). Every layer further out is waiting on the layer inside it, so if an
outer layer's timeout is shorter, it fires first and replaces that specific
error with its own generic "didn't respond in time" message — the useful
information is there, but never reaches the user. Getting this backwards is
easy because the constants live in different files, written at different
times, with no shared constant or compile-time link between them; each site
carries a comment naming the other layers so a future edit can see it's part
of a ladder rather than an independent, arbitrary timeout.

This is not a hypothetical concern — it happened twice on this project, on
the old four-layer version of the ladder.
`boards/project-backlog/28-fix-inverted-tool-call-timeout-ladder.md` describes
the verification harness (card 25) catching a real hang test
(`hangs-forever`, one of the demo tools) coming back with the worker's
generic message instead of the innermost layer's specific timed-out message,
because the worker's `CALL_TIMEOUT_MS` had originally been set shorter than
the layer inside it by an agent working on the worker without visibility
into the ladder already established elsewhere.
`boards/project-backlog/30-panel-timeout-outside-ladder.md` is the sequel:
once the worker was fixed, it turned out the side panel had its *own*
timeout that nobody had counted as part of the ladder at all — fixed by
raising it to 35s, still the case today. If you touch any of these three
constants, update the comments at the other two sites, and if you add a
fourth layer, give it the widest margin and document it the same way.

## Session ownership: one `ChatSession`, one owner

`src/sidepanel/stores/panel.svelte.ts` is documented (in its own module
comment) as the **sole in-memory owner** of the tab's `ChatSession` object.
Every other module that needs the current selection, message history, or
tool-call log reads or writes through it rather than holding its own copy.

This invariant exists because it was violated once, silently:
`src/sidepanel/stores/selection.svelte.ts` used to hold its own separate
`ChatSession` snapshot purely so `selectModel()` could persist the chosen
`{ providerId, model }`. Meanwhile the agent loop was appending new messages
to the session through `panel.svelte.ts`'s live view. Two holders of the same
logical session existed, only one of them ever saw new messages, and
`selectModel()`'s write silently overwrote the other's (newer) history with
its own stale copy — see
`boards/project-backlog/29-selection-store-stale-session-write.md`. The
symptom was quiet: the on-screen conversation looked fine right up until the
panel was closed and reopened, at which point the overwritten messages were
simply gone. The fix removed the second copy entirely rather than trying to
keep two copies in sync — `selection.svelte.ts` now reads/writes the
selection field through `panel.svelte.ts`'s accessors
(`getSessionSelection`/`setSessionSelection`) instead of loading its own
session. The general lesson the card states explicitly: **no writer may
persist a session it did not just read.**

# Architecture

The extension is split across four separate JavaScript execution contexts
that cannot see each other's variables and can only talk over explicit
message-passing. This split is invisible from the file tree unless you
already know MV3, so this page exists to make it explicit.

```
┌─────────────────────────────┐        DOM CustomEvents          ┌──────────────────────────────┐
│  MAIN-world bridge           │  webmcp-bridge:out / :in        │  ISOLATED-world relay         │
│  src/inject/bridge.ts        │ ───────────────────────────────▶│  src/content/relay.ts         │
│  runs IN the page's own      │◀─────────────────────────────── │  runs alongside the page,     │
│  JS world; can see           │                                  │  can see chrome.runtime but   │
│  navigator.modelContext      │                                  │  NOT page globals             │
└──────────────┬───────────────┘                                  └───────────────┬───────────────┘
               │ page's own execute() closures,                                    │ chrome.runtime.sendMessage /
               │ same-origin privileges, never                                     │ onMessage
               │ leave this world                                                  │
                                                                                     ▼
                                                                    ┌──────────────────────────────┐
                                                                    │  Service worker (background)  │
                                                                    │  src/background/sw.ts         │
                                                                    │  per-tab tool registry,       │
                                                                    │  message broker only —        │
                                                                    │  never talks to a chat         │
                                                                    │  backend itself                │
                                                                    └───────────────┬───────────────┘
                                                                                     │ chrome.runtime messaging
                                                                                     ▼
                                                                    ┌──────────────────────────────┐
                                                                    │  Side panel                    │
                                                                    │  src/sidepanel/**              │
                                                                    │  owns the HTTP/streaming        │
                                                                    │  connection to the active       │
                                                                    │  provider directly; the sole    │
                                                                    │  in-memory ChatSession owner    │
                                                                    └──────────────────────────────┘
```

## The four contexts

### 1. MAIN-world bridge — `src/inject/bridge.ts`

Injected at `document_start` with `world: "MAIN"` (manifest content script,
`manifest.config.ts`), so it runs *in the page's own JavaScript world* — the
only place that can see `navigator.modelContext` as a live object, since an
extension's ordinary (ISOLATED-world) content script cannot see page
globals at all. This is why a MAIN-world script exists instead of just
reading the property from the relay (see
`decisions/02-mainworld-webmcp-bridge.md`).

Its entire job is to install a shim on `navigator.modelContext` that handles
three situations a WebMCP page can be in — see
[Compatibility](02-webmcp-compatibility.md) for the page-facing view, and
[The adopt-or-provide shim](#the-adopt-or-provide-shim) below for how it
works internally.

Everything it hands across the world boundary is serialized to a **JSON
string** on a `CustomEvent` — live objects, closures, and functions never
cross (`window.__webmcpBridgeInstalled` is the one exception: a plain marker
object stamped on `window` purely so the relay/verification harness can
confirm the bridge actually landed in this world, per
`boards/project-backlog/25-in-browser-verification-harness.md`).

### 2. ISOLATED-world relay — `src/content/relay.ts`

Also injected at `document_start`, but in the default ISOLATED world. This
is the only context that can see *both* the bridge's `CustomEvent`s (DOM
events cross worlds even though objects don't) and `chrome.runtime` (page
scripts cannot reach `chrome.runtime` at all). It exists purely to ferry
messages between the two:

- Listens for `webmcp-bridge:out` events (tool list announcements, call
  results) and forwards tool lists up to the service worker as
  `runtime:tools-updated`.
- Listens for `runtime:call-tool` from the service worker, dispatches a
  `bridge:call-request` `CustomEvent` into the page, and resolves the
  matching pending call by id when `bridge:call-result` comes back.
- Re-requests the current tool list (`bridge:get-tools`) on its own startup
  and on `pageshow` with `persisted: true` (a back/forward-cache restore),
  since either the relay or the bridge can come up first and a panel opened
  after both need the current list rather than nothing.
- Fails every outstanding pending call on `pagehide` (`persisted: false`,
  i.e. a real navigation away), so the service worker is never left hanging
  on a call whose page no longer exists.

### 3. Service worker — `src/background/sw.ts`

The MV3 background service worker. Deliberately small
(`decisions/04-ollama-transport.md`, generalized by
`decisions/09-provider-agnostic-chat-transport.md`): it never talks to
Ollama, OpenAI, or any chat backend. Its three jobs:

- `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` —
  the toolbar icon opens the panel directly, no popup.
- Holds the **authoritative per-tab tool registry**, a `Map<tabId, {origin,
  tools}>`, updated from the relay's `runtime:tools-updated` pushes and
  cleared on `chrome.tabs.onUpdated` (navigation) and `chrome.tabs.onRemoved`
  (tab close) — see `decisions/07-session-state-and-persistence.md`.
- Brokers tool calls: relays `runtime:call-tool` from the panel to the right
  tab's relay and returns the result, and reports a clear, specific error
  ("no relay in this tab") for pages a content script can't run on at all —
  `chrome://` pages, the Web Store, the PDF viewer.

Because MV3 service workers are killed after ~30s idle, the in-memory
registry can be wiped at any time. Nothing treats that as fatal: a cache miss
falls back to a live pull from the tab's relay (`runtime:refresh-tools`), so
the registry self-heals after a restart instead of silently reporting zero
tools.

### 4. Side panel — `src/sidepanel/**`

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

1. User sends a message. `src/sidepanel/services/agentLoop.ts` sends the
   conversation plus the active tab's tool list to the active provider's
   `chat()` and streams the reply into the transcript.
2. The model's response includes a `tool_calls` entry. The agent loop checks
   the approval policy (`decisions/05-tool-approval-policy.md`): a call whose
   `annotations.readOnlyHint === true` runs immediately; anything else —
   including a tool with no annotations at all — blocks on an approve/deny
   card in the UI.
3. Once cleared to run, the panel sends `runtime:call-tool` to the service
   worker.
4. The service worker looks up which tab owns the session, forwards the call
   to that tab's relay as `runtime:call-tool` over `chrome.runtime`
   messaging.
5. The relay dispatches a `bridge:call-request` `CustomEvent` into the page.
6. The bridge looks up the tool, invokes its (page-supplied) `execute` with
   the given arguments, and returns `{ id, ok, result | error }` — after a
   JSON round-trip, so a non-serializable or exception-throwing `execute`
   still produces a clean result rather than crashing anything.
7. The result travels back up the same chain: bridge → relay → service
   worker → panel. The panel appends it as a `role: "tool"` message and the
   loop continues until the model stops calling tools or an 8-iteration cap
   trips.

## The adopt-or-provide shim

Full rationale: `decisions/02-mainworld-webmcp-bridge.md`. The mechanics,
because they're easy to get subtly wrong:

`install()` (`src/inject/bridge.ts`) checks whatever is currently at
`navigator.modelContext`:

- **Nothing there → provide.** The shim itself becomes the implementation,
  serving pages that assume `navigator.modelContext` exists.
- **Something already there → adopt.** The shim records bound references to
  the existing implementation's methods (not the live object itself — see
  below) and forwards every registration to it, so the page's own behavior
  (native Chrome support, or a polyfill like `@mcp-b/global` that already
  ran) is untouched. Tools are tagged with a `source` of `"native"` or
  `"polyfill"` (a `[native code]` `toString()` heuristic distinguishes them)
  so downstream UI can show provenance.
- Either way, `navigator.modelContext` is then redefined as an **accessor
  property**: the getter always returns the shim, and the **setter** is what
  makes **late adoption** work — if a polyfill script runs *after* the
  bridge and assigns `navigator.modelContext = new SomePolyfill()`, the
  setter intercepts that assignment, adopts the new object as the
  underlying implementation, migrates across any tools that were registered
  in provide-mode before the polyfill showed up, and re-emits the tool list.
  This is the exact scenario `demo/late.html` exercises — see
  [Compatibility](02-webmcp-compatibility.md).

One implementation detail worth knowing if you're modifying the bridge: the
adopt path snapshots *bound references* to the original object's methods
rather than holding onto the live object, specifically so a fallback path
(`patchInPlace`, used only when `Object.defineProperty` itself throws because
the property is non-configurable) can safely overwrite the existing object's
own methods without infinitely recursing into itself.

Every tool call runs through `callWithTimeout` with its own timeout (see
below) and every result is passed through a JSON round-trip before being
emitted — a throwing, hanging, or non-serializable `execute` always produces
a clean `{ ok: false, error }`, never a wedged bridge or an uncaught
exception that could take the page down.

## The four-rung timeout ladder

A tool call passes through four layers before a result (or timeout) reaches
the user: **panel → worker → relay → bridge**, and back. Each layer sets its
own timeout on the call it's waiting on, and the ladder only works if the
budgets are ordered **innermost-shortest**:

| Layer | Constant | Value | File |
|---|---|---|---|
| Bridge (innermost) | `EXECUTE_TIMEOUT_MS` | 20s | `src/inject/bridge.ts` |
| Relay | `RELAY_CALL_TIMEOUT_MS` | 25s | `src/content/relay.ts` |
| Service worker | `CALL_TIMEOUT_MS` | 30s | `src/background/sw.ts` |
| Side panel (outermost) | `TOOL_CALL_TIMEOUT_MS` | 35s | `src/sidepanel/services/agentLoop.ts` |

The reasoning: the bridge is the only layer that actually knows *what*
timed out (it's sitting right next to the page's `execute` call) and can
produce a specific, useful error. Every layer further out is waiting on the
layer inside it, so if an outer layer's timeout is shorter, it fires first
and replaces that specific error with its own generic "didn't respond in
time" message — the useful information is there, but never reaches the
user. Getting this backwards is easy because the four constants live in four
different files, written at different times, with no shared constant or
compile-time link between them; each site now carries a comment naming the
other three so a future edit can see it's part of a ladder rather than an
independent, arbitrary timeout.

This is not a hypothetical concern — it happened twice on this project.
`boards/project-backlog/28-fix-inverted-tool-call-timeout-ladder.md` describes
the verification harness (card 25) catching a real hang test
(`hangs-forever`, one of the demo tools) coming back with the worker's
generic message instead of the bridge's specific 20s-timeout message,
because the worker's `CALL_TIMEOUT_MS` had originally been set to 15s —
shorter than the bridge and relay both — by an agent working on the worker
without visibility into the ladder the bridge/relay agent had already
established. `boards/project-backlog/30-panel-timeout-outside-ladder.md` is
the sequel: once the worker was fixed, it turned out the side panel had its
*own* 20s timeout that nobody had counted as part of the ladder at all,
sitting outside all three other layers yet no longer than the innermost one
— fixed by raising it to 35s. If you touch any of these four constants,
update the comments at the other three sites, and if you add a fifth layer,
give it the widest margin and document it the same way.

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

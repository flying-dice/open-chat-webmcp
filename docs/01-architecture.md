# Architecture

This codebase is sliced two ways at once, and both slices matter:

- **By runtime context.** MV3 splits the extension across JavaScript
  execution contexts that cannot see each other's variables and can only talk
  over explicit message-passing. That split is invisible from the file tree
  unless you already know MV3.
- **By layer.** Inside each of those contexts the code is DDD-hexagonal
  ([decisions/29](../decisions/29-ddd-hexagonal-typescript-layout.md)):
  `src/domain/<context>` owns the model and the ports, `src/infra/<tech>`
  adapts both sides, `src/ui` is the shared presentation kit, and each
  runtime surface's entry point composes them. That split *is* visible in the
  file tree — deliberately, because the folder graph is the architecture, and
  `npm run guard` enforces it.

The rest of this page walks both, then the cross-cutting mechanics (a tool
call end to end, the timeout ladder, session ownership) and where the tests
sit.

## The runtime contexts

```
┌────────────────────────────────┐
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
┌────────────────────────────────┐
│  Service worker (background)   │
│  src/background/sw.ts          │
│  per-tab tool registry,        │
│  message broker only —         │
│  never talks to a chat         │
│  backend itself                │
└───────────────┬────────────────┘
                │ chrome.runtime messaging
                ▼
┌────────────────────────────────┐     ┌──────────────────────────┐
│  Side panel                    │     │  Options page            │
│  src/sidepanel/**              │     │  src/options/**          │
│  owns the HTTP/streaming       │     │  providers, MCP servers, │
│  connection to the active      │     │  approval policies,      │
│  provider directly; drives     │     │  clear-history. Its own  │
│  ChatService                   │     │  bundle, no messaging.   │
└────────────────────────────────┘     └──────────────────────────┘
```

There used to be a fifth context: a MAIN-world bridge (`src/inject/bridge.ts`)
that installed an "adopt-or-provide" shim on `navigator.modelContext` so the
extension could discover tools regardless of whether the browser itself, a
polyfill, or neither implemented WebMCP. It is **deleted**. See
[decisions/16](../decisions/16-native-webmcp-client.md) for why: the premise
that discovery required injecting into the page's own JS world turned out to
be wrong — `document.modelContext` is a genuine `Document`-scoped IDL
attribute, so the ISOLATED-world relay can read it directly, with no
MAIN-world script needed at all. The practical trade this bought: the
extension is now interoperable with the WebMCP ecosystem (the official
inspector extension and this extension see the identical tool set on the same
page — verified, see card
[43](../boards/project-backlog/43-native-modelcontext-client.md)'s journal),
at the cost of no longer working on a browser without native WebMCP support.
See [Compatibility](02-webmcp-compatibility.md) for what that trade means in
practice.

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
the service worker for the current tab's tools and routes page-tool calls
through it, but the token stream itself goes straight from the provider's
HTTP response into the UI.

Consequence worth knowing: **closing the side panel aborts any in-flight
generation.** The request is tied to the panel's lifetime via an
`AbortController`; there is no mechanism to keep it going in the background.

### 4. Options page — `src/options/**`

A second Svelte 5 app, its own HTML entry point and its own bundle. It
registers chat providers and MCP servers (including the OAuth sign-in flow of
[decisions/27](../decisions/27-oauth-for-http-mcp-servers.md)), sets the two
approval policies, and clears chat history. It talks to no other context —
everything it changes, it changes through storage ports, and the panel picks
the change up through the same ports' change subscriptions.

## The layers

[decisions/29](../decisions/29-ddd-hexagonal-typescript-layout.md) and
[decisions/33](../decisions/33-shared-ui-layer.md) fix four layers, and a
module wears its layer in its path:

```
src/domain/<context>    the model, the rules, and the PORTS. No chrome.*,
                        no fetch, no DOM, no Svelte, no npm dependency.
src/infra/<tech>        one adapter folder per technology. Implements ports
                        (driven) and wraps platform APIs (driving).
src/ui                  shared presentation both Svelte surfaces render
                        through, plus the vendored shadcn-svelte kit.
src/{sidepanel,options,background,content}
                        the four runtime surfaces, each with exactly one
                        composition root.
```

The dependency direction is **composition root → infra → domain, and nothing
else**.

### Bounded contexts — `src/domain/*`

Four contexts plus one shared kernel. Each has a `README.md` with the full
inventory; this is the map.

| Context | Owns | Driven ports it declares |
| --- | --- | --- |
| `chat` | the `ChatSession` aggregate, the persisted `TranscriptEntry`, the agent turn (iteration cap, approval gating, untrusted-content fencing, the tool-call race), transcript grouping, title derivation, and `ChatService` — the **driving** port a surface calls | `ChatStore`, `ModelGateway`, `ToolExecutor`, `ApprovalRequester`, `ChatPresenter` |
| `providers` | the provider-agnostic `ChatProvider` contract and its error vocabulary, the tool-capability policy, the preset catalogue, selection resolution (including the tri-state "dangling provider") | `ProviderRegistry`, `ProviderDefaultsStore`, `ModelCapabilityCache` |
| `tools` | tool descriptors, the merge algebra that namespaces server tools alongside page tools, MCP server configs and their reserved-header rule, and the sign-in *order* | `McpToolGateway`, `McpOAuthClient`, `McpServerRegistry`, `McpAuthTokenStore`, `PageToolExecutor` |
| `permissions` | what a host permission means for a URL | `HostPermissions` |
| `storage` *(shared kernel, not a context)* | `StorageError` and its five kinds — the one vocabulary every storage port rejects with ([decisions/32](../decisions/32-storage-ports-and-error-vocabulary.md)) | — |

Two rules make this hold up rather than merely look tidy:

- **Contexts meet at their barrels.** `src/domain/tools/sign-in.ts` may
  import `../permissions`; it may not import `../permissions/host-permissions`.
  The same applies from outside: import `src/domain/chat`, never
  `src/domain/chat/turn`.
- **The domain must run in a bare Node test with zero platform mocks.** That
  is what makes the domain half of the test pyramid cheap, and it is checked
  by a source scan, not by convention (see [The guards](#the-guards)).

### Adapters — `src/infra/*`

One folder per technology, never per feature. Each also has its own
`README.md`.

| Folder | What it adapts |
| --- | --- |
| `chrome-storage` | every storage port, over `chrome.storage`, including the sync/local **credential split** (decisions/10, 15). `area.ts` is the only place `chrome.storage` is called and the only place a platform failure becomes a `StorageError`; `keyed-record-store.ts` is the one "ordered core list in sync, per-id credentials in local" mechanic both registries configure. |
| `chrome-runtime` | the six-message cross-context protocol, the page-tool executor (`runtime:call-tool`), host permissions, tab-sync listeners, and the extension shell (open the options page, and friends) |
| `mcp` | the HTTP MCP client — protocol `2025-06-18` over Streamable HTTP with legacy SSE fallback — plus the whole OAuth 2.1 (PKCE) discovery/registration/sign-in/refresh chain |
| `ollama` | the Ollama REST client (`/api/tags`, `/api/show`, NDJSON `/api/chat`) and its `ChatProvider` adapter |
| `openai` | the OpenAI-compatible client (`/v1/models`, SSE `/v1/chat/completions`) and its `ChatProvider` adapter |
| `webmcp` | the timeout ladder's single source of truth (`timeouts.mjs`) — plain `.mjs` so the no-build `verify/` harness can import the same constants the extension ships |
| `dom` | the browser-document capabilities a root wires at boot — today, mirroring `prefers-color-scheme` onto `<html class="dark">` |

**Adapters never import each other.** Two that need one another meet at a
domain port instead. This is not a style preference: it is the rule that
stops the pre-DDD inversion where the MCP transport stack wrote the config
store from inside itself. When card 76 moved `oauth.ts` into `src/infra/mcp`
with its `updateServer` call intact, the guard failed on the first run —
which is why that write now goes out through `McpAuthTokenStore`, injected at
the wiring site.

**Where a new adapter goes.** Ask what technology it speaks, not what feature
asked for it. A new `src/infra/<tech>/` folder; a port on the domain context
that needs it; a line in the composition root of each surface that uses it. If
the answer to "what technology?" is "none, it's a rule" it belongs in
`src/domain`; if it is "none, it's a picture" it belongs in `src/ui` or in
that surface's own components.

### The four composition roots

Exactly one per runtime surface, and the **only** modules allowed to name a
concrete adapter:

| Root | Wires |
| --- | --- |
| `src/sidepanel/main.ts` | the storage ports, the provider client factory, the MCP gateway, dark-mode sync, tab-sync listeners — then hands them to the UI through `src/sidepanel/app-services.ts` and mounts `App.svelte` |
| `src/options/main.ts` | the same storage ports plus the whole OAuth client (the options page is the surface that drives interactive sign-in), handed over through `src/options/app-services.ts` |
| `src/background/sw.ts` | the message listeners, the per-tab registry, the side-panel behaviour, the timeout ladder's middle rung |
| `src/content/relay.ts` | `document.modelContext`, the protocol, and the ladder's innermost rung |

[decisions/29](../decisions/29-ddd-hexagonal-typescript-layout.md) counts
three roots because it counts the three modules it happened to name. There are
four: the content script is a fourth runtime surface with its own entry point,
its own bundle and its own lifecycle, and it wires infrastructure exactly the
way `sw.ts` does. Card 78 found this the moment the "only roots construct
infra" rule was switched on, and the honest fix was to admit the fourth root
rather than grant it an exception.

A component or store never constructs an adapter — not for an instance, not
for a type, not for a constant. If you need a TYPE from an adapter, the type
belongs in `src/domain`; if you need an INSTANCE, the root builds it and
hands it to you.

## The guards

`npm run guard` is two scripts, and neither alone is the guard.

**`npm run guard:boundaries`** = `depcruise` + `scripts/guard-boundaries.mjs`.

dependency-cruiser (`.dependency-cruiser.cjs`) enforces the dependency
*direction* over `.ts` and `.svelte` alike:

| Rule | Says |
| --- | --- |
| `domain-is-pure` | nothing in `src/domain` imports anything outside `src/domain` |
| `domain-has-no-dependencies` | `src/domain` takes no npm dependency at all |
| `domain-contexts-meet-at-barrels` | one context imports another only through its `index.ts` |
| `contexts-are-imported-through-their-barrel` | so does everything outside the domain |
| `infra-does-not-import-ui` | an adapter is driven by a surface, never the reverse |
| `adapters-do-not-import-adapters` | two adapters meet at a domain port |
| `only-roots-construct-infra` | only a composition root reaches for an adapter |
| `ui-does-not-import-infra` | the same rule, worded for components and stores |
| `no-src-lib` | the pre-DDD grab bag is gone and may not be recreated |
| `shared-ui-is-ui-only` | `src/ui` sees `src/domain` and itself, nothing else |
| `no-cross-surface-imports` | one surface never imports another's modules |

Two hygiene rules sit alongside them: `no-unresolvable` (an import that
resolves to nothing — almost always a path left stale by a move, which is what
cards 73-78 did constantly) as an **error**, and `no-circular` as a
**warning**. The latter cannot be promoted: `ToolArgValue.svelte` imports
itself, which is how a Svelte component renders a recursive JSON tree. It is
reported on every run and does not fail the guard — the same "visible,
accepted debt" treatment decisions/31 gives a ≤ 0.5 clean-code marker.

What dependency-cruiser structurally **cannot** see is platform *globals*:
`chrome.*`, `fetch`, `document`, `window`, `localStorage` are not imports at
all, so a domain module could grow a platform dependency while the import
graph stayed clean. `scripts/guard-boundaries.mjs` scans source text for
exactly that, in four passes:

- **domain purity** — no `chrome.*`, `fetch()`, DOM globals or Svelte runes in
  `src/domain`;
- **`chrome.*` containment** — only under `src/infra/` and the four
  composition roots;
- **`chrome.storage` containment** — inside `src/infra`, only
  `src/infra/chrome-storage/`;
- **`chrome.identity` containment** — inside `src/infra`, only
  `src/infra/mcp/`.

All three containment scans run with an **empty exception list**, and that is
the shape they are meant to stay in: an entry may only be added alongside a
board card that deletes it again. `.svelte` files are scanned script-block
only — five components tell the user in rendered prose that their API key is
kept in `chrome.storage.local`, and markup is copy, not code.

**`npm run guard:clean-code`** enforces
[decisions/31](../decisions/31-clean-code-guard.md): a
`// TODO: clean-code - <score> - <CATEGORY>: <why>` marker scoring **> 0.5**
fails the build; **≤ 0.5** is reported and allowed, as documented, visible,
accepted debt. A marker whose score cannot be parsed also fails. The vendored
shadcn kit under `src/ui/components/ui/` is excluded from both guards — it is
generated source, not our architecture.

## Testing

[decisions/30](../decisions/30-vitest-test-pyramid.md) fixes the shape. The
short version is that `npm test` is the fast layer and `npm run verify` is the
slow one; [Testing](05-testing.md) has the detail, including the release-gate
command list.

## UI and styling

There are two UI surfaces — the side panel (`src/sidepanel/**`) and the
options page (`src/options/**`) — and they are separate HTML entry points
with separate JS and CSS bundles. What they share lives in `src/ui/`, the
shared UI layer: `src/ui/components/ui/` (the vendored component kit) and
`src/ui/components/` (cross-surface components like `Markdown.svelte`),
alongside `markdown.ts`, `icons.ts` and `providerIcon.ts`. That folder was
`src/lib` until card 78 emptied it of everything that was not UI and
[decisions/33](../decisions/33-shared-ui-layer.md) renamed it; the `$lib`
alias still spells itself `$lib` (the shadcn CLI's convention) and points
there.

Both are built on **[shadcn-svelte](https://shadcn-svelte.com) + Tailwind CSS
v4**, in the **Maia** style over the **Zinc** base colour
([decisions/28](../decisions/28-shadcn-svelte-maia-zinc.md)). Concretely:

- **One stylesheet, `src/app.css`**, imported first by each entry point's
  `main.ts` and by nothing else. It pulls in Tailwind, `tw-animate-css`,
  shadcn's Tailwind layer and the Figtree variable font, then declares the
  Zinc token block (`--background`, `--foreground`, `--primary`, `--muted`,
  `--border`, `--radius`, …) for `:root` and again for `.dark`, and maps them
  onto Tailwind's theme in an `@theme inline` block. It is **generated**, not
  hand-written: regenerate with
  `npx shadcn-svelte@1.5.0 apply bc6ENMW -y --skip-preflight` rather than
  editing token values in place.
- **Components style themselves with Tailwind utilities and shadcn
  variants.** There is no project design-token layer and no per-component
  `<style>` block, with exactly two deliberate exceptions:
  `ActivityIndicator.svelte`'s streaming-shimmer keyframes (an animated
  `background-clip: text` gradient Tailwind has no utility for, plus its
  `prefers-reduced-motion` fallback) and `Markdown.svelte`'s descendant rules,
  which have to be plain CSS because the markup they target arrives through
  `{@html}` and the Svelte compiler never sees it. Both read shadcn's own
  tokens.
- **The vendored kit in `src/ui/components/ui/` is generated source**, added
  by the shadcn CLI and owned by it — exempt from the repo's clean-code and
  module-boundary guards, and re-generated rather than refactored.
- **Icons** are [Hugeicons](https://hugeicons.com) (Maia's pairing), mapped
  from name to component inside `src/sidepanel/components/Icon.svelte`.
  `src/ui/icons.ts` carries only the two marks that aren't stock glyphs — the
  `sparkle` star and the Ollama logo — as inline SVG path data.
- **Dark mode** is the `.dark` class on `<html>`, synced from
  `prefers-color-scheme` by `src/infra/dom/dark-mode.ts`, which each `main.ts` calls
  *before* mounting so the first paint is already in the right theme. Both
  `index.html` files carry `class="scheme-light-dark"` so the browser's own
  form controls, scrollbars and pre-paint background follow suit.
- **No remote assets.** Figtree ships as `@fontsource-variable/figtree` and
  Hugeicons as npm packages, so nothing in `dist/` reaches out to a CDN —
  which MV3's CSP would block anyway.

This replaces three earlier hand-written stylesheets — `src/lib/theme.css`
(a Chrome-native design-token set, [decisions/08](../decisions/08-native-chrome-design-language.md)),
`src/sidepanel/chat-theme.css` (a Material-3-expressive overlay that beat it
on specificity, [decisions/18](../decisions/18-side-panel-material-expressive.md))
and `src/options/options.css` — all three of which are now deleted, along with
~2,100 lines of per-component scoped CSS. Decisions 08 and 18 are Superseded.

A few legacy class names survive as **styling-free hooks**:
`.picker__trigger` (`ProviderPicker.svelte`), `.activity-group .summary`
(`ActivityGroup.svelte`) and `.step .row-head` (`ToolCallRow.svelte`). They
exist only so `verify/checks/screenshots.mjs` can drive those surfaces, whose
accessible names move with the seeded data; each is commented as such at its
definition. Everything else that check locates, it locates by role and
accessible name — so a UI change that renames a button breaks the screenshot
matrix loudly rather than silently capturing fewer shots.

## A tool call, end to end

1. User sends a message. `src/domain/chat`'s turn (assembled by
   `src/sidepanel/services/chatTurn.ts`) builds ONE
   merged tool list — the active tab's page tools plus every enabled MCP
   server's currently-cached tools, namespaced `<serverSlug>__<toolName>`
   so a server tool can never collide with a page tool or another server's
   ([decisions/19](../decisions/19-merging-server-tools-with-page-tools.md))
   — and sends it, plus the conversation, to the active provider's `chat()`,
   streaming the reply into the transcript. Server tool discovery
   (`src/sidepanel/services/mcpTools.ts`) runs in the background and is
   never awaited on this critical path: a slow, dead, unauthenticated, or
   not-yet-permitted server simply contributes no tools this turn.
2. The model's response includes a `tool_calls` entry. The turn
   resolves the requested name back to its merged entry and applies THAT
   entry's own source's policy — a page tool by the unchanged decisions/05/17
   rule (`annotations.readOnlyHint === true` runs immediately; anything else,
   including no annotations at all, blocks on an approve/deny card), a
   server tool by its own, separate, stricter
   [decisions/20](../decisions/20-approval-policy-is-per-tool-source.md)
   rule (default: every server call blocks on approval regardless of
   `readOnlyHint`). The two policies share no decision logic
   (`src/domain/settings`) and are configured independently on the options
   page.
3. Once cleared to run, a PAGE tool call goes through the worker/relay hops
   below; a SERVER tool call instead goes straight out over HTTP via
   the `McpToolGateway` port's `callServerTool` (`src/domain/tools`,
   implemented in `src/infra/mcp`). `executeToolCall` itself never
   branches on which kind it's calling — it just invokes whichever executor
   the merged entry already carries.
4. **Page tools only:** the panel sends `runtime:call-tool` to the service
   worker (through `src/domain/tools`'s `PageToolExecutor` port, implemented
   in `src/infra/chrome-runtime/page-tool-executor.ts`), which looks up which
   tab owns the chat and forwards the call to that tab's relay over
   `chrome.runtime` messaging.
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
   the model's context (`fenceUntrustedContent` in
   `src/domain/chat/message.ts`; see
   [decisions/17](../decisions/17-spec-annotations-and-untrusted-content.md));
   the transcript also marks such results visibly and states WHERE the call
   ran (decisions/19 §6) on every surface that names it — the tools list, the
   approval card, and the call log. The panel appends the (unfenced) result
   as a `role: "tool"` entry and the loop continues until the model stops
   calling tools or an 8-iteration cap trips.

## The timeout ladder

A tool call passes through two layers before a result (or timeout) reaches
the relay's own `executeTool` call, and a third layer — the panel — sits
outside that as the overall UI budget: **relay → worker**, with the **panel**
watching the whole round trip from outside. Each layer sets its own timeout,
ordered **innermost-shortest**:

| Layer | Constant | Value | Applied in |
|---|---|---|---|
| Relay (innermost) | `RELAY_EXECUTE_TIMEOUT_MS` | 20s | `src/content/relay.ts` |
| Service worker | `SW_CALL_TIMEOUT_MS` | 30s | `src/background/sw.ts` |
| Side panel (outermost) | `AGENT_LOOP_TOOL_CALL_TIMEOUT_MS` | 35s | injected into `src/domain/chat/turn.ts` by `src/sidepanel/services/chatTurn.ts` |

All three rungs are declared **once**, in
`src/infra/webmcp/timeouts.mjs` (card 79). It is plain `.mjs` rather than
`.ts` on purpose: `verify/run.mjs` is a real Node ESM script with no build
step, so it cannot import TypeScript, but it can import that file by its
literal path — which means the harness asserts against the same numbers the
extension ships, not a copy of them. `tsconfig.app.json` has
`allowJs`+`checkJs` on, so the file is typechecked like any other.

[decisions/16](../decisions/16-native-webmcp-client.md) deleted the ladder's
former innermost rung: the MAIN-world bridge used to own execution and set
its own 20s timeout. The relay now owns execution directly against
`document.modelContext.executeTool()` and inherited that same 20s budget, one
layer further out than before. The ladder is two layers deep now (relay →
worker), plus the panel's own outer budget, rather than the original four
(bridge → relay → worker → panel).

The reasoning for keeping budgets ordered innermost-shortest is unchanged:
the relay is the layer closest to the actual `executeTool` call and can
produce a specific, useful error ("Timed out after 20000ms running the
tool."). Every layer further out is waiting on the layer inside it, so if an
outer layer's timeout is shorter, it fires first and replaces that specific
error with its own generic "didn't respond in time" message — the useful
information is there, but never reaches the user.

This is not a hypothetical concern — it happened twice on this project, on
the old four-layer version of the ladder.
`boards/project-backlog/28-fix-inverted-tool-call-timeout-ladder.md` describes
the verification harness (card 25) catching a real hang test
(`hangs-forever`, one of the demo tools) coming back with the worker's
generic message instead of the innermost layer's specific timed-out message,
because the worker's timeout had originally been set shorter than the layer
inside it by an agent working on the worker without visibility into the ladder
already established elsewhere.
`boards/project-backlog/30-panel-timeout-outside-ladder.md` is the sequel:
once the worker was fixed, it turned out the side panel had its *own*
timeout that nobody had counted as part of the ladder at all — fixed by
raising it to 35s, still the case today. Card 79 is what removed the
underlying hazard: there is now one file to edit, and its header states the
ordering invariant. `npm run verify` asserts the innermost rung end to end
(the `hangs-forever` check) against that same constant.

## Session ownership: one chat, one owner

`ChatService` (`src/domain/chat/service.ts`) owns **which chat a tab is
showing and every path that persists one**. `src/sidepanel/stores/panel.svelte.ts`
is the panel's view state around it — streaming buffers, turn phases,
connection status, page info, tool lists — and holds no second copy of a
chat's messages or selection.

This split exists because the old arrangement was violated once, silently.
`src/sidepanel/stores/selection.svelte.ts` used to hold its own separate
`ChatSession` snapshot purely so `selectModel()` could persist the chosen
`{ providerId, model }`, while the agent loop appended new messages to the
session through the panel store's live view. Two holders of the same logical
session existed, only one of them ever saw new messages, and `selectModel()`'s
write silently overwrote the other's (newer) history with its own stale copy —
see `boards/project-backlog/29-selection-store-stale-session-write.md`. The
symptom was quiet: the on-screen conversation looked fine right up until the
panel was closed and reopened, at which point the overwritten messages were
simply gone.

The fix removed the second copy rather than trying to keep two in sync, and
card 77 finished the job by moving the ownership itself out of the UI: a store
cannot persist a chat at all now, it asks `ChatService` to. The general rule
the card states explicitly, and which still holds: **no writer may persist a
session it did not just read.**

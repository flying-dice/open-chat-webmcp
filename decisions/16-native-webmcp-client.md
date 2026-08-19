---
status: Accepted
date: 2026-08-19
---
# Decision 16 — Consume native `document.modelContext` from the ISOLATED world; delete the MAIN-world shim

Supersedes [decisions/02](02-mainworld-webmcp-bridge.md).

## Context

Decision 02 injected a MAIN-world "adopt-or-provide" shim onto
`navigator.modelContext`. Its central justification was:

> Enumerating tools out of the native implementation is also not possible —
> there is no read API for "what has this page registered".

That premise is no longer true, and the API it targeted no longer exists. The
WebMCP spec ([webmachinelearning/webmcp](https://github.com/webmachinelearning/webmcp))
has been through three breaking migrations since decision 02 was written:

| Decision 02 assumed | Spec today | Changed |
|---|---|---|
| `navigator.modelContext` | `document.modelContext` | [PR #184](https://github.com/webmachinelearning/webmcp/pull/184), 2026-05-27 |
| `provideContext({ tools })` | removed | [PR #132](https://github.com/webmachinelearning/webmcp/pull/132), 2026-03-05 |
| `unregisterTool(name)` | removed — `AbortSignal` | [PR #156](https://github.com/webmachinelearning/webmcp/pull/156), 2026-03-27 |
| `registerTool() -> { destroy() }` | `-> Promise<undefined>`, takes `{ signal }` | [#147](https://github.com/webmachinelearning/webmcp/pull/147), [#200](https://github.com/webmachinelearning/webmcp/pull/200) |
| `callTool(name, args)` | `executeTool(registeredTool, input)` | — |
| no read API | **`getTools({ fromOrigins })`** | — |
| no change signal | **`ontoolchange`** | — |

The practical consequence was that this extension was invisible to every other
WebMCP consumer: the official inspector
([model-context-tool-inspector](https://github.com/beaufortfrancois/model-context-tool-inspector))
reads `document.modelContext` from the ISOLATED world and saw nothing on our
own demo pages, while our side panel showed six tools.

### Verified against the implementation, not the docs

The spec's published IDL and Chrome's shipped behaviour disagree in ways that
matter. The following was measured directly against Google Chrome 151.0.7922.138
and Chrome for Testing 152.0.7977.54 (probe: a MAIN-world page registering a
tool, an ISOLATED-world content script reading it):

- **An ISOLATED-world content script sees tools the page registered in the
  MAIN world.** `document.modelContext` is a real IDL attribute on `Document`,
  so both worlds address the same document-scoped registry. This is the
  assumption the whole decision rests on, and it holds.
- `ontoolchange` is settable from the ISOLATED world and fires on both
  registration and abort-driven unregistration.
- `AbortController.abort()` removes the tool from `getTools()` — confirmed
  1 → 0.
- **`RegisteredTool.inputSchema` is a JSON `string`, not an object.** It must
  be `JSON.parse`d. The spec IDL says `object`.
- **`executeTool(tool, input)` requires `input` to be a JSON string.** Passing
  an object fails with `UnknownError: Failed to parse input arguments`. The
  spec IDL says `optional object inputObject`. The return is a nullable
  `DOMString` containing JSON.
  **This one is mid-migration and must not be hardcoded.** The official
  inspector (`content.js:41-49`) tries the *object* form first and falls back
  to the string form only on an error starting with `"Failed to parse input"`,
  carrying the TODO *"Remove this when executeTool doesn't accept JSON
  stringified inputArgs anymore in Chrome Stable."* In other words the string
  form is what works today and is the form being retired. Mirror the
  inspector: try object, fall back to string, rethrow anything else.
- `executeTool` takes the `RegisteredTool` **object**, not a name — so the
  live objects from `getTools()` must be retained to call anything. Resolve
  name → object with the frame guard the inspector uses,
  `t.name === name && t.window === window`: `getTools()` can return tools from
  other frames, so matching on name alone can resolve a top-frame call to a
  same-named tool in a subframe.
- `RegisteredTool` carries a live `window` reference, which is not
  structured-cloneable and must be stripped before it crosses to the worker.
- `annotations` is exactly `{ readOnlyHint, untrustedContentHint }`, both
  defaulted to `false`. There is no `destructiveHint`
  (see [decisions/17](17-spec-annotations-and-untrusted-content.md)).
- `navigator.modelContext` still exists in 151/152 as a deprecated alias
  ("navigator.modelContext is deprecated. Please use document.modelContext
  instead.") and is the same object in the MAIN world.
- WebMCP is **off by default**. It is enabled by `--enable-features=WebMCP`,
  the `chrome://flags/#enable-webmcp-testing` toggle, or a per-origin
  **origin-trial token**. Playwright's bundled Chromium does not have the
  feature compiled in at all.

## Decision

**Consume the native API directly from the ISOLATED-world content script, and
delete the MAIN-world bridge entirely.**

- `src/content/relay.ts` reads `document.modelContext` itself:
  `getTools()` for discovery, `ontoolchange` for live updates,
  `executeTool(tool, JSON.stringify(args))` for invocation.
- `src/inject/bridge.ts` is **deleted**, along with the `world: "MAIN"`
  content-script entry, the `BRIDGE_IN_EVENT`/`BRIDGE_OUT_EVENT` CustomEvent
  transport, the `standaloneFiles` build carve-out, and the `ToolSource`
  (`native`/`polyfill`/`shim`) concept.
- The extension no longer *provides* an implementation to any page. It only
  reads one the browser provides.
- Native WebMCP becomes a **hard requirement**: Chrome 149+ with the feature
  enabled, or a page carrying an origin-trial token.

## Consequences

- We become interoperable: any page the official inspector sees, we see, and
  vice versa. That is the whole point.
- **Pages relying on a JS polyfill become invisible to us.** A polyfill
  installs `document.modelContext` in the MAIN world only, which an
  ISOLATED-world script cannot observe. Supporting them would require
  reintroducing a MAIN-world script; we are explicitly choosing not to.
- **Pages with no WebMCP support are no longer given one.** Decision 02's
  "provide" mode is gone. A page that calls `registerTool` blind now throws,
  exactly as it would with no extension installed. This is correct behaviour,
  not a regression to route around.
- The extension does nothing on a Chrome without the flag or an OT token. The
  UI must say so plainly rather than looking broken
  (see `docs/04-troubleshooting.md`).
- The timeout ladder loses its innermost rung. The relay now owns tool
  execution directly: relay 20s → worker 30s.
  (`boards/project-backlog/30-panel-timeout-outside-ladder.md` still applies to
  the panel's own 20s budget.)
- Large net deletion: the 555-line bridge, the CustomEvent protocol half of
  `src/lib/protocol.ts`, the world-isolation assertions, and both
  polyfill-oriented demo variants.
- `npm run verify` can no longer use Playwright's bundled Chromium. It must run
  Chrome for Testing with `--enable-features=WebMCP`, which is also the only
  branded-derived build that still honours `--load-extension`.

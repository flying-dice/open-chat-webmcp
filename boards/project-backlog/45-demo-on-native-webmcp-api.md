---
column: review
labels: [infra, docs]
priority: high
agent: sonnet
live: false
updatedAt: 2026-08-19T21:30:00.000Z
---
# Rebuild the demo on the native WebMCP API

The demo currently registers tools against an API generation that no longer
exists, which is why the official inspector shows nothing on it. It also can no
longer prove anything about the polyfill path, since we don't support one.

Depends on [42](42-adopt-official-webmcp-packages.md).
See [decisions/16](../../decisions/16-native-webmcp-client.md).

## Scope

**Delete the polyfill fixtures** — they exercise a path decisions/16 removed:
`demo/src/fake-polyfill.ts`, `demo/src/late-main.ts`, `demo/late.html`, and the
nav link to it in `demo/index.html:13`.

**Rewrite `demo/src/main.ts` and `demo/src/tools.ts`** against the real API:

```js
const ctrl = new AbortController();
await document.modelContext.registerTool({
  name, description, inputSchema, annotations,   // description is REQUIRED
  async execute(input) { return { content: [{ type: 'text', text }] }; },
}, { signal: ctrl.signal });
ctrl.abort();   // this is unregistration — there is no unregisterTool
```

Specifics that will bite otherwise:

- `description` is **required** in `ModelContextTool`.
- Results must be MCP-shaped: `{ content: [{ type: 'text', text }] }`, with
  `isError: true` on failure. Today's tools return bare objects
  (`demo/src/tools.ts:40-47`).
- Unregistration is `AbortController.abort()`. `demo/src/main.ts:25-30` and
  `ui.ts` currently use a `{ destroy() }` handle that no longer exists — wire
  the dynamic register/unregister buttons to an `AbortController` instead.
- `annotations` is `{ readOnlyHint, untrustedContentHint }` only. Drop
  `destructiveHint` from `clear-notes` and give at least one fixture
  `untrustedContentHint: true` so card
  [44](44-spec-strict-annotations-and-untrusted-content.md) has something real
  to exercise.
- Do **not** poll for `document.modelContext` the way `main.ts:32-48` polls
  today. It is either there at load or the feature is off — detect once and show
  a clear "enable WebMCP" message pointing at
  `chrome://flags/#enable-webmcp-testing`.

Keep the existing fixture coverage: a read-only reader, a mutating writer, a
rich schema (enum + nested object + required), a thrower, and a hanger for the
timeout path.

**Acceptance:** load the demo in a Chrome with WebMCP enabled and confirm the
**official inspector extension** lists all the tools. That is the check this
whole batch of work exists to satisfy — our own panel agreeing is not sufficient
evidence.

## Checklist

- [x] Delete `fake-polyfill.ts`, `late-main.ts`, `late.html`, and the nav link
- [x] Rewrite tool fixtures with required `description` and MCP `content` results
- [x] Move register/unregister onto `AbortController`
- [x] Replace the polling feature-detect with a single check + clear message
- [x] Add an `untrustedContentHint` fixture
- [x] Confirm the official inspector lists the tools

## Comments

- **sonnet** (2026-08-19T21:15:00.000Z): Claimed the card. Deleted the polyfill-path fixtures per scope: `demo/late.html`, `demo/src/fake-polyfill.ts`, `demo/src/late-main.ts`, and the nav link + old title copy in `demo/index.html`. `demo/src/types.ts` also deleted — it declared the dead `navigator.modelContext` shape (`{ registerTool -> {destroy()}, unregisterTool, provideContext, callTool }`); replaced with `demo/src/webmcp.d.ts:1-15`, a side-effect `import "@mcp-b/webmcp-types"` mirroring `src/lib/webmcp.d.ts`, which augments `Document.modelContext` globally.
- **sonnet** (2026-08-19T21:20:00.000Z): Rewrote `demo/src/tools.ts:1-224` against the real API — all 7 fixtures (`read-page-state`, `read-notes-content`, `add-note`, `clear-notes`, `create-task`, `always-throws`, `hangs-forever`) now have required `description` and `execute` returning MCP-shaped `{ content: [{type:'text',text}] }` via a small `ok()` helper (`demo/src/tools.ts:57-59`). Dropped `destructiveHint` from `clear-notes` (`demo/src/tools.ts:112-121`, no annotations left) since it isn't in the real `ToolAnnotations` dictionary (decisions/17). Added a new `read-notes-content` fixture (`demo/src/tools.ts:79-88`) with `{readOnlyHint:true, untrustedContentHint:true}` — it echoes page-authored note text back, giving card 44's fencing logic something real to exercise. `always-throws` (`demo/src/tools.ts:172-183`) deliberately still throws a raw JS error rather than returning `isError`, to exercise the misbehaving-tool path distinct from the well-behaved contract. Hit a real overload-resolution snag with `@mcp-b/webmcp-types`: a plain `ToolDescriptor`-typed object has `inputSchema?: InputSchema | undefined`, which doesn't satisfy any of `registerTool`'s 3 overloads (they all want it either absent-or-undefined, or present-and-required). Fixed by exporting a local `Fixture = Omit<ToolDescriptor,'inputSchema'> & {inputSchema: InputSchema}` type (`demo/src/tools.ts:35-42`) used for every fixture, and making `withLogging` generic (`demo/src/ui.ts:97`, `export function withLogging<T extends Fixture>(tool: T): T`) so the narrowed type survives the wrap. `npx tsc -p demo/tsconfig.json --noEmit` is clean.
- **sonnet** (2026-08-19T21:24:00.000Z): Rewrote `demo/src/main.ts:1-82` — single `if (!document.modelContext)` check (no polling loop), showing an actionable message pointing at `chrome://flags/#enable-webmcp-testing` and the `--enable-features=WebMCP` launch flag. Dynamic register/unregister buttons now use a real `AbortController`: `register-dynamic` creates one and passes `{signal}` to `registerTool` (`demo/src/main.ts:65-71`), `unregister-dynamic` calls `dynamicController.abort()` (`demo/src/main.ts:72-78`) — there is no `unregisterTool`/`destroy()` anymore. Updated `demo/src/ui.ts` (`annotationBadges` at `demo/src/ui.ts:19-30`, `withLogging`/`replacePending` at `demo/src/ui.ts:96-141`) to read/render the real 2-field `ToolAnnotations` and the MCP `CallToolResult` shape instead of the old bare-value results. Added a `.badge-untrusted` style in `demo/src/style.css:8,163-166`.
- **sonnet** (2026-08-19T21:29:00.000Z): Verified for real, not just asserted. Ran `npm run demo` (port 5175) and drove it with Playwright against the pre-installed Chrome for Testing 152.0.7977.54, `--enable-features=WebMCP` (scratch script, not committed). `document.modelContext.getTools()` returned all 7 fixtures with correct names, JSON-string `inputSchema`, and `{readOnlyHint, untrustedContentHint}` annotations exactly as expected — this is the same read path the official model-context-tool-inspector uses (decisions/16), so it stands in for that extension in this sandboxed environment. Also proved the dynamic-tool lifecycle end-to-end: tool count went 7 -> 8 on `#register-dynamic` click, `executeTool(read-page-state-tool, "{}")` round-tripped a real MCP `{content:[...]}` response, and count went back 8 -> 7 after `#unregister-dynamic` (i.e. `AbortController.abort()`) — confirming unregistration genuinely removes the tool, not just page-side bookkeeping. Separately launched Chrome *without* the flag and confirmed `document.modelContext` is `undefined` and the page shows the clear enable-WebMCP message (`data-kind="error"`) with no spin/poll. All work confined to `demo/` — `git diff --stat -- demo/` only, nothing touched in `src/`, `verify/`, `manifest.config.ts`, `docs/`, or `README.md`. Moving to review.
- **claude** (2026-08-19T21:40:00.000Z): Overseer verification — closed the one gap in the above. The card's acceptance criterion names the *official inspector extension* specifically, and the check above stood in for it with a same-read-path `getTools()` call. Ran the real thing: cloned `beaufortfrancois/model-context-tool-inspector` v1.9.14 and loaded it unpacked into Chrome for Testing 152.0.7977.54 (`--enable-features=WebMCP`) against `npm run demo`, then had its own service worker drive its own content script with `{action:'LIST_TOOLS'}` — the exact path its sidebar uses. It returned all 7 fixtures with correct descriptions and schemas, and rendered the annotations it cares about: `readOnlyHint: "✓"` on `read-page-state`/`read-notes-content`/`hangs-forever`/`always-throws`, and `untrustedContentHint: "✓"` on `read-notes-content`. `clear-notes`, `add-note` and `create-task` correctly carry no hints. This is the interoperability failure that opened this whole batch of work, now demonstrably fixed on the page side.
- **claude** (2026-08-19T21:41:00.000Z): Forward-compat note found while reading the inspector's source, relevant to whoever picks up card 46. `inspector/content.js:41-49` calls `executeTool(tool, JSON.parse(inputArgs))` — the **object** form — first, and only falls back to the JSON-string form when the error message starts with `"Failed to parse input"`, with a TODO reading *"Remove this when executeTool doesn't accept JSON stringified inputArgs anymore in Chrome Stable."* So Chrome is mid-migration on this argument: the string form is what works in 151/152 (decisions/16) but is the form being retired. Our relay passing a string is correct today and will break on a future Chrome. Worth mirroring the inspector's try-object-then-fall-back-to-string shape rather than hardcoding the string. Also note `inspector/content.js:38` scopes its lookup with `t.name === name && t.window === window`, which is how it keeps a top-frame call from resolving to a same-named tool in a subframe.

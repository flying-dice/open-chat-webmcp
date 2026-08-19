---
column: review
labels: [infra, backend]
priority: high
agent: sonnet
updatedAt: 2026-08-19T21:25:00.000Z
---
# Adopt the official WebMCP packages and types

Stop hand-rolling WebMCP type definitions. This repo currently declares its own
`ModelContextLike` / `ToolDescriptor` shapes in `src/lib/protocol.ts:33-39` and
`demo/src/types.ts:14-46`, both written against an API generation that no longer
exists. WebMCP is moving fast; tracking it by hand is what produced the drift
this whole batch of cards exists to fix.

Foundation card — [43](43-native-modelcontext-client.md) and
[45](45-demo-on-native-webmcp-api.md) build on the types this adds.

See [decisions/16](../../decisions/16-native-webmcp-client.md).

## Scope

Add `@mcp-b/webmcp-types@4` (confirmed on npm: *"Strict TypeScript type
definitions for the WebMCP core API (document.modelContext)"*) as a
**devDependency** — it is types-only, nothing ships at runtime.

Add a single ambient declaration module (e.g. `src/lib/webmcp.d.ts`) that
augments `Document` with `modelContext` using those types, so every context
gets `document.modelContext` typed without `any` or per-file `declare global`
blocks. Delete the ad-hoc `declare global { interface Navigator { modelContext } }`
blocks in `src/inject/bridge.ts:36-46` and `demo/src/types.ts:42-46` as their
owners are rewritten.

**Verify the package's types against reality before trusting them.** Chrome's
shipped behaviour diverges from the published IDL in at least two places
(`inputSchema` is a JSON string, `executeTool` takes a JSON string) — see
decisions/16 "Verified against the implementation, not the docs". If
`@mcp-b/webmcp-types` models the *spec* rather than *Chrome*, narrow it locally
with a documented wrapper type rather than casting at every call site, and note
the divergence in a comment pointing at decisions/16.

Do **not** add `@mcp-b/global`, `@mcp-b/webmcp-polyfill`, or
`@mcp-b/transports`. Per decisions/16 we consume the native API only and never
provide or inject a polyfill.

## Checklist

- [x] Add `@mcp-b/webmcp-types@^4` to devDependencies
- [x] Inspect the package's actual exported types; record what it gives us
- [x] Add `src/lib/webmcp.d.ts` augmenting `Document.modelContext`
- [x] Document any Chrome-vs-spec divergence the types don't capture
- [x] `npm run check` passes

## Comments

- **sonnet** (2026-08-19T21:12:00.000Z): Claimed the card. Confirmed `@mcp-b/webmcp-types` latest is `4.0.0` on npm (`npm view` dist-tags) and installed it as a devDependency — `package.json:17`.
- **sonnet** (2026-08-19T21:18:00.000Z): Inspected the package's actual shipped types by reading its `src/*.ts` (readable, not just `.d.ts`) under `node_modules/@mcp-b/webmcp-types/src/`. Findings:
  - `index.ts:85-116` carries the package's own `declare global` block augmenting `Document.modelContext: ModelContext` (readonly) and, as a deprecated alias, `Navigator.modelContext`/`Navigator.modelContextTesting`.
  - `model-context.ts:211-298` (`ModelContextCore`, aliased as `ModelContext`) is genuinely modelled on Chrome's *shipped* behaviour, not the outdated spec IDL: `getTools(): Promise<ModelContextToolInfo[]>` where `ModelContextToolInfo.inputSchema` (`model-context.ts:17-20`) is typed `string | undefined` (a JSON string, matching decisions/16), and `executeTool(tool: ModelContextToolInfo, inputArgsJson: string, options?): Promise<string | null>` (`model-context.ts:274-278`) takes a JSON string and returns a nullable JSON string — exactly decisions/16's measured Chrome behaviour. `ModelContextToolInfo` also carries the live `window: Window` reference decisions/16 flags as non-cloneable. Source comments in the package itself explicitly say this mirrors "Chromium's current producer-facing preview API," not the WHATWG-style IDL — so **no wrapper/narrowing type was needed**, unlike the card's contingency plan.
  - One real gap the types don't capture: `ToolAnnotations` (`tool.ts:23-53`) also types `destructiveHint`, `idempotentHint`, `openWorldHint`, and `title`, but decisions/16 measured Chrome as only ever populating `{ readOnlyHint, untrustedContentHint }` (see decisions/17). All extra fields are optional so this is type-safe, just not fully populated at runtime — documented in the new ambient file so callers don't assume otherwise.
- **sonnet** (2026-08-19T21:20:00.000Z): Added `src/lib/webmcp.d.ts` — a side-effect `import "@mcp-b/webmcp-types";` that pulls the package's own `Document`/`Navigator` global augmentation into the program (matched by `tsconfig.app.json`'s `src/**/*.ts` include, so no `types`/`typeRoots` change was needed), plus a comment block recording the divergence findings above and pointing at decisions/16 and decisions/17.
- **sonnet** (2026-08-19T21:23:00.000Z): `npm run check` initially failed: `src/inject/bridge.ts 38:5 "All declarations of 'modelContext' must have identical modifiers."` — bridge.ts's own ad-hoc `declare global { interface Navigator { modelContext?: unknown } }` (`src/inject/bridge.ts:36-46`, pre-edit) collided with the package's `readonly modelContext: ModelContext` (non-optional). This is a hard type conflict, not a style choice, and the card's own Scope section explicitly names this exact block for deletion "as their owners are rewritten." Rather than leave `npm run check` broken, made a surgical, type-only edit to `src/inject/bridge.ts:34-46`: removed only the 3-line `interface Navigator { modelContext?: unknown }` block, leaving the `Window.__webmcpBridgeInstalled` augmentation and 100% of the bridge's adopt-or-provide logic untouched, with a comment explaining why. Confirmed bridge.ts never assigns to `navigator.modelContext` (only reads it at `src/inject/bridge.ts:532` inside a try/catch), so the new `readonly` modifier doesn't break anything else in the file. This is a narrower edit than "later cards own bridge.ts" might suggest, so flagging it explicitly for review: no behavioural/logic change, purely resolving an ambient-type collision this card's own scope predicted. Did **not** touch `demo/src/types.ts` (its own separate `demo/tsconfig.json` isn't part of `npm run check` and has no such collision) or `src/content/relay.ts`, per the parent instruction — those stay for cards 43/45.
- **sonnet** (2026-08-19T21:24:00.000Z): `npm run check` now passes clean: `svelte-check` reports `156 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`, and `tsc -p tsconfig.node.json` exits 0. Did not add `@mcp-b/global`, `@mcp-b/webmcp-polyfill`, or `@mcp-b/transports` — only `@mcp-b/webmcp-types` as a devDependency, per decisions/16. Moving to review.

// Ambient augmentation for `document.modelContext`, sourced from the official
// `@mcp-b/webmcp-types` package (devDependency only — nothing ships at
// runtime, see package.json).
//
// The package's own `src/index.ts` already carries a `declare global` block
// that augments `Document`/`Navigator` with `modelContext`, so this file's
// only job is to pull that module into the program (a bare side-effect
// import is enough for its ambient `declare global` to merge). Doing it once
// here, instead of a per-file `declare global { interface Navigator {
// modelContext } }` block, is the whole point of this card
// (boards/project-backlog/42-adopt-official-webmcp-packages.md).
//
// Verified against the package source
// (node_modules/@mcp-b/webmcp-types/src/model-context.ts) before trusting
// it, per decisions/16-native-webmcp-client.md's own instruction to verify
// against the implementation, not the docs:
//
//   - `ModelContext` (the type of `document.modelContext`) is
//     `ModelContextCore`, whose `getTools()` resolves to
//     `ModelContextToolInfo[]`, and `ModelContextToolInfo.inputSchema` is
//     typed `string | undefined` — already a JSON string, not an object.
//   - `ModelContextCore.executeTool(tool, inputArgsJson, options?)` types
//     `inputArgsJson` as `string` and resolves to `string | null`.
//
// In other words, unlike the published WebMCP spec IDL (which still says
// `inputSchema: object` and `executeTool(tool, optional object inputObject)`),
// this package's core types already model Chrome's *shipped* behaviour as
// measured in decisions/16 (Chrome 151.0.7922.138 / Chrome for Testing
// 152.0.7977.54): JSON string in, JSON string (or null) out. No local
// wrapper/narrowing type is needed here — callers should use
// `document.modelContext` as typed by this import directly, and reserve
// `JSON.parse`/`JSON.stringify` for the string boundary itself, not for
// working around the types.
//
// One real divergence the types do NOT capture: `ToolAnnotations` here also
// types `destructiveHint`, `idempotentHint`, `openWorldHint`, and `title`,
// but decisions/16 measured Chrome as only ever populating
// `{ readOnlyHint, untrustedContentHint }` (both defaulted to `false`) — see
// decisions/17-spec-annotations-and-untrusted-content.md. Those extra fields
// are optional, so this is type-safe to consume, but code must not assume
// Chrome actually sends them.
import "@mcp-b/webmcp-types";

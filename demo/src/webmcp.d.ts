// Ambient augmentation for `document.modelContext`, sourced from the official
// `@mcp-b/webmcp-types` package (devDependency only — nothing ships at
// runtime; see ../../package.json). Mirrors src/lib/webmcp.d.ts — the demo
// is a standalone static site (demo/vite.config.ts) with its own tsconfig,
// so it needs its own side-effect import to pull in the same global
// `declare global { interface Document { modelContext } }` augmentation.
//
// See decisions/16-native-webmcp-client.md for what was actually measured
// against Chrome 151/152 (JSON-string inputSchema, JSON-string in/out on
// executeTool, no destroy()/unregisterTool handle — AbortSignal only) and
// decisions/17-spec-annotations-and-untrusted-content.md for why
// `ToolAnnotations` here carries more optional fields than Chrome actually
// ever populates (`{ readOnlyHint, untrustedContentHint }` only).
import "@mcp-b/webmcp-types";

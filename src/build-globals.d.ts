// Build-time constants substituted by Vite's `define` (vite.config.ts).
//
// Card 76: src/infra/mcp announces a name and version in the MCP
// `initialize` handshake, and used to get them by importing package.json —
// an adapter reaching outside `src/` for build metadata, and the whole
// manifest pulled into the bundle for two strings. These are literals in the
// output instead, filled from the same package.json that manifest.config.ts
// already reads, so the wire value is unchanged.
//
// Declared as `const` rather than `var`/`let` because that is what they are
// after substitution — a reassignment should not typecheck. Nothing may
// reference these outside the app bundle: they do not exist at runtime in a
// bare Node context (no `define` pass), which is also why src/domain must
// never touch them.

declare const __APP_NAME__: string;
declare const __APP_VERSION__: string;

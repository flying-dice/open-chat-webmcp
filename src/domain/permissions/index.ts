// `permissions` bounded context (card 78,
// decisions/29-ddd-hexagonal-typescript-layout.md): whether this extension is
// allowed to reach a given origin at all, and how a surface asks.
//
// One rule (`originPatternForUrl`) and one driven port (`HostPermissions`) —
// see ./host-permissions.ts for why this is its own context rather than a
// member of `providers` or `tools`, both of which depend on it.
//
// Pure TypeScript — no `chrome.*`, no `fetch`, no DOM, no Svelte. The
// `chrome.permissions` implementation of the port is an adapter and lives in
// src/infra/chrome-runtime/permissions.ts.
//
// This barrel is the context's public face: other contexts and the outer
// layers import `src/domain/permissions`, never a file inside it.

export * from "./host-permissions";

// `settings` bounded context (decisions/29-ddd-hexagonal-typescript-layout.md):
// the two approval policies (decisions/05, decisions/20), their defaults and
// their validators, plus `SettingsStore` — the driven port that reads,
// writes and watches them.
//
// Card 74 landed the policies and the port; the "does this tool call need a
// human?" rule still to come from src/sidepanel/services/agentLoop.ts is
// card 77's (see ./README.md).
//
// Pure TypeScript — no `chrome.*`, no `fetch`, no DOM, no Svelte. The
// `chrome.storage.sync` implementation of `SettingsStore` is an adapter and
// lives in src/infra/chrome-storage.
//
// This barrel is the context's public face: other contexts and the outer
// layers import `src/domain/settings`, never a file inside it.

export * from "./approval-policy";

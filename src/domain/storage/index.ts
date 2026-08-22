// `storage` — the shared kernel for driven STORAGE ports
// (decisions/29-ddd-hexagonal-typescript-layout.md,
// decisions/32-storage-ports-and-error-vocabulary.md).
//
// Not a bounded context in its own right: it models no part of the problem
// domain and owns no rules. It holds the ONE error vocabulary that
// `chat`, `providers`, `tools` and `settings` all speak when they declare a
// repository port, so an adapter has a single target to map
// `chrome.runtime.lastError`, a quota `DOMException` or a malformed record
// into, and a caller has a single type to catch. Four private copies of the
// same five-member union would be four things to keep in step for no gain.
//
// Pure TypeScript — no `chrome.*`, no `fetch`, no DOM, no Svelte. Other
// contexts import `src/domain/storage`, never a file inside it.

export * from "./error";

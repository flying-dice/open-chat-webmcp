// `chrome-runtime` adapter — see ./README.md for what lands here and from
// where. Card 73 landed the messaging half (the six-message `chrome.runtime`
// protocol, moved from src/lib/protocol.ts); card 77 added the page-tool
// executor, the one `chrome.runtime` round trip the agent loop used to make
// itself. Card 78 completed the folder with the three pieces the README had
// been naming since card 73 — the tab listeners, host permissions, and the
// extension's own chrome — each now the ONLY implementation of a port a
// composition root injects.

export { createPageToolExecutor } from "./page-tool-executor";
export { createChromeHostPermissions } from "./permissions";
export { createExtensionShell, type ExtensionShell } from "./extension-shell";
export {
  createTabToolsLookup,
  startTabSync,
  type ResolvedPage,
  type TabSyncOptions,
  type TabSyncSession,
  type TabSyncView,
} from "./tab-sync";

export {
  isRuntimeMessage,
  type Msg,
  type RuntimeCallToolRequest,
  type RuntimeCallToolResponse,
  type RuntimeGetToolsRequest,
  type RuntimeGetToolsResponse,
  type RuntimeMessage,
  type RuntimeNotification,
  type RuntimeRefreshToolsRequest,
  type RuntimeRequest,
  type RuntimeResponse,
  type RuntimeToolsUpdatedMessage,
  type SerializedTool,
  type ToolAnnotations,
} from "./protocol";

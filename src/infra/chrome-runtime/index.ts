// `chrome-runtime` adapter — see ./README.md for what lands here and from
// where. Card 73 landed the messaging half (the six-message `chrome.runtime`
// protocol, moved from src/lib/protocol.ts); card 77 added the page-tool
// executor, the one `chrome.runtime` round trip the agent loop used to make
// itself; the tab and permissions pieces the README also names are card 78's.

export { createPageToolExecutor } from "./page-tool-executor";

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

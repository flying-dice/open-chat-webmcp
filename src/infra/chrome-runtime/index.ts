// `chrome-runtime` adapter — see ./README.md for what lands here and from
// where. Card 79 landed the messaging half (the six-message
// `chrome.runtime` protocol, moved from src/lib/protocol.ts); the tab,
// permissions, and identity pieces the README also names are later cards'.

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

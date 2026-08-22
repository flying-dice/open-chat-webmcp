// `tools/list` and `tools/call` result parsing (card 76; moved unchanged from
// src/lib/mcp/client.ts), plus the two session-level operations built on it.
//
// Deliberately defensive: a malformed individual tool or content item is
// dropped or coerced rather than failing the whole call — the same posture
// src/infra/openai's `normalizeModel` takes toward a malformed model entry.
// `tools/list` (with `cursor`/`nextCursor` pagination) and `tools/call`
// (`content`/`structuredContent`/`isError`) match
// /specification/2025-06-18/server/tools.

import type {
  McpResult,
  McpTool,
  McpToolCallResult,
  McpToolContent,
} from "../../domain/tools";
import { isRecord } from "./json-rpc";
import type { McpWireSession } from "./session";

function normalizeTool(raw: unknown): McpTool | null {
  if (!isRecord(raw) || typeof raw.name !== "string" || raw.name.length === 0) return null;
  return {
    name: raw.name,
    title: typeof raw.title === "string" ? raw.title : undefined,
    description: typeof raw.description === "string" ? raw.description : undefined,
    inputSchema: isRecord(raw.inputSchema) ? raw.inputSchema : undefined,
    outputSchema: isRecord(raw.outputSchema) ? raw.outputSchema : undefined,
    annotations: isRecord(raw.annotations) ? raw.annotations : undefined,
  };
}

function parseToolsListResult(value: unknown): McpResult<{ tools: McpTool[]; nextCursor?: string }> {
  if (!isRecord(value) || !Array.isArray(value.tools)) {
    return { ok: false, error: { kind: "invalid-response", message: "tools/list result was missing a `tools` array." } };
  }
  const tools = value.tools.map(normalizeTool).filter((t): t is McpTool => t !== null);
  const nextCursor = typeof value.nextCursor === "string" ? value.nextCursor : undefined;
  return { ok: true, value: { tools, nextCursor } };
}

/** Coerce one tools/call `content` item into a known {@link McpToolContent} shape, falling back to a `text` item carrying the raw JSON for anything unrecognized (a future content type, or a malformed one) rather than dropping it — nothing the server returned silently disappears. */
function normalizeContent(raw: unknown): McpToolContent {
  const fallback = (): McpToolContent => ({ type: "text", text: JSON.stringify(raw) });
  if (!isRecord(raw) || typeof raw.type !== "string") return fallback();
  switch (raw.type) {
    case "text":
      return typeof raw.text === "string" ? { type: "text", text: raw.text } : fallback();
    case "image":
      return typeof raw.data === "string" && typeof raw.mimeType === "string"
        ? { type: "image", data: raw.data, mimeType: raw.mimeType }
        : fallback();
    case "audio":
      return typeof raw.data === "string" && typeof raw.mimeType === "string"
        ? { type: "audio", data: raw.data, mimeType: raw.mimeType }
        : fallback();
    case "resource_link":
      return typeof raw.uri === "string"
        ? {
            type: "resource_link",
            uri: raw.uri,
            name: typeof raw.name === "string" ? raw.name : undefined,
            description: typeof raw.description === "string" ? raw.description : undefined,
            mimeType: typeof raw.mimeType === "string" ? raw.mimeType : undefined,
          }
        : fallback();
    case "resource":
      return isRecord(raw.resource) && typeof raw.resource.uri === "string"
        ? {
            type: "resource",
            resource: {
              uri: raw.resource.uri,
              mimeType: typeof raw.resource.mimeType === "string" ? raw.resource.mimeType : undefined,
              text: typeof raw.resource.text === "string" ? raw.resource.text : undefined,
              blob: typeof raw.resource.blob === "string" ? raw.resource.blob : undefined,
            },
          }
        : fallback();
    default:
      return fallback();
  }
}

function parseToolCallResult(value: unknown): McpResult<McpToolCallResult> {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    return { ok: false, error: { kind: "invalid-response", message: "tools/call result was missing a `content` array." } };
  }
  return {
    ok: true,
    value: {
      content: value.content.map(normalizeContent),
      structuredContent: isRecord(value.structuredContent) ? value.structuredContent : undefined,
      isError: typeof value.isError === "boolean" ? value.isError : false,
    },
  };
}

/** Follows `nextCursor` per the spec's pagination convention, bounded defensively so a server that never terminates pagination can't loop forever within the caller's own timeout budget. */
export async function listToolsViaSession(session: McpWireSession): Promise<McpResult<McpTool[]>> {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  let guard = 0;
  const MAX_PAGES = 50;
  do {
    const result = await session.request("tools/list", cursor ? { cursor } : {});
    if (!result.ok) return result;
    const parsed = parseToolsListResult(result.value);
    if (!parsed.ok) return parsed;
    tools.push(...parsed.value.tools);
    cursor = parsed.value.nextCursor;
    guard += 1;
  } while (cursor && guard < MAX_PAGES);
  return { ok: true, value: tools };
}

export async function callToolViaSession(
  session: McpWireSession,
  toolName: string,
  args: Record<string, unknown> | undefined,
): Promise<McpResult<McpToolCallResult>> {
  const result = await session.request("tools/call", { name: toolName, arguments: args ?? {} });
  if (!result.ok) return result;
  return parseToolCallResult(result.value);
}

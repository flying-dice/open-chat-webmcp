// `tools/list` and `tools/call` result parsing (card 76; moved unchanged from
// src/lib/mcp/client.ts), plus the two session-level operations built on it.
//
// Deliberately defensive: a malformed individual tool or content item is
// dropped or coerced rather than failing the whole call — the same posture
// src/infra/openai's `normalizeModel` takes toward a malformed model entry.
// `tools/list` (with `cursor`/`nextCursor` pagination) and `tools/call`
// (`content`/`structuredContent`/`isError`) match
// /specification/2025-06-18/server/tools.

import { fail, ok, type Result } from "../../domain/result";
import type { McpError, McpTool, McpToolCallResult, McpToolContent } from "../../domain/tools";
import { isRecord } from "./json-rpc";
import type { McpWireSession } from "./session";

function normalizeTool(raw: unknown): McpTool | null {
  if (!isRecord(raw) || typeof raw.name !== "string" || raw.name.length === 0) return null;
  // `McpTool.outputSchema` (src/domain/tools, not this folder's to widen)
  // is optional without `| undefined` — conditional spread so a missing
  // schema omits the key instead of assigning it `undefined`.
  const outputSchema = isRecord(raw.outputSchema) ? raw.outputSchema : undefined;
  return {
    name: raw.name,
    title: typeof raw.title === "string" ? raw.title : undefined,
    description: typeof raw.description === "string" ? raw.description : undefined,
    inputSchema: isRecord(raw.inputSchema) ? raw.inputSchema : undefined,
    ...(outputSchema !== undefined && { outputSchema }),
    annotations: isRecord(raw.annotations) ? raw.annotations : undefined,
  };
}

function parseToolsListResult(
  value: unknown,
): Result<{ tools: McpTool[]; nextCursor?: string | undefined }, McpError> {
  if (!isRecord(value) || !Array.isArray(value.tools)) {
    return fail({
      kind: "invalid-response",
      message: "tools/list result was missing a `tools` array.",
    });
  }
  const tools = value.tools.map(normalizeTool).filter((t): t is McpTool => t !== null);
  const nextCursor = typeof value.nextCursor === "string" ? value.nextCursor : undefined;
  return ok({ tools, nextCursor });
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
      // `McpResourceLinkContent.name`/`.mimeType` (src/domain/tools, not
      // this folder's to widen) are optional without `| undefined` —
      // conditional spread so an absent value omits the key instead of
      // assigning it `undefined`.
      return typeof raw.uri === "string"
        ? {
            type: "resource_link",
            uri: raw.uri,
            ...(typeof raw.name === "string" && { name: raw.name }),
            description: typeof raw.description === "string" ? raw.description : undefined,
            ...(typeof raw.mimeType === "string" && { mimeType: raw.mimeType }),
          }
        : fallback();
    case "resource":
      // `McpEmbeddedResourceContent.resource`'s `mimeType`/`text`/`blob`
      // (src/domain/tools, not this folder's to widen) are optional without
      // `| undefined` — same conditional-spread treatment.
      return isRecord(raw.resource) && typeof raw.resource.uri === "string"
        ? {
            type: "resource",
            resource: {
              uri: raw.resource.uri,
              ...(typeof raw.resource.mimeType === "string" && {
                mimeType: raw.resource.mimeType,
              }),
              ...(typeof raw.resource.text === "string" && { text: raw.resource.text }),
              ...(typeof raw.resource.blob === "string" && { blob: raw.resource.blob }),
            },
          }
        : fallback();
    default:
      return fallback();
  }
}

function parseToolCallResult(value: unknown): Result<McpToolCallResult, McpError> {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    return fail({
      kind: "invalid-response",
      message: "tools/call result was missing a `content` array.",
    });
  }
  // `McpToolCallResult.structuredContent` (src/domain/tools, not this
  // folder's to widen) is optional without `| undefined` — conditional
  // spread so an absent value omits the key instead of assigning it
  // `undefined`.
  const structuredContent = isRecord(value.structuredContent) ? value.structuredContent : undefined;
  return ok({
    content: value.content.map(normalizeContent),
    ...(structuredContent !== undefined && { structuredContent }),
    isError: typeof value.isError === "boolean" ? value.isError : false,
  });
}

/** Follows `nextCursor` per the spec's pagination convention, bounded defensively so a server that never terminates pagination can't loop forever within the caller's own timeout budget. */
export async function listToolsViaSession(
  session: McpWireSession,
): Promise<Result<McpTool[], McpError>> {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  let guard = 0;
  const MAX_PAGES = 50;
  do {
    const [value, err] = await session.request("tools/list", cursor ? { cursor } : {});
    if (err) return fail(err);
    const [parsed, parsedErr] = parseToolsListResult(value);
    if (parsedErr) return fail(parsedErr);
    tools.push(...parsed.tools);
    cursor = parsed.nextCursor;
    guard += 1;
  } while (cursor && guard < MAX_PAGES);
  return ok(tools);
}

export async function callToolViaSession(
  session: McpWireSession,
  toolName: string,
  args: Record<string, unknown> | undefined,
): Promise<Result<McpToolCallResult, McpError>> {
  const [value, err] = await session.request("tools/call", {
    name: toolName,
    arguments: args ?? {},
  });
  if (err) return fail(err);
  return parseToolCallResult(value);
}

// Tests for JSON-RPC envelope parsing and the mapping into the domain's
// `McpError` vocabulary — the single place an HTTP status or a JSON-RPC
// `error` object becomes something the domain understands (card 83).

import { describe, expect, it } from "vitest";
import {
  classifyHttpErrorResponse,
  classifyRpcError,
  isJsonRpcResponse,
  isRecord,
  safeAuthMessage,
  toResultFromJsonRpc,
  truncate,
  tryParseJsonRpcError,
  type JsonRpcErrorObject,
} from "./json-rpc";

describe("isRecord", () => {
  it("distinguishes plain objects from arrays/null/primitives", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });
});

describe("truncate", () => {
  it("leaves short strings untouched", () => {
    expect(truncate("short", 500)).toBe("short");
  });

  it("truncates and appends an ellipsis past max", () => {
    const result = truncate("abcdefghij", 5);
    expect(result).toBe("abcde…");
  });
});

describe("isJsonRpcResponse", () => {
  it("accepts an envelope with jsonrpc:2.0 and a result key", () => {
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: {} })).toBe(true);
  });

  it("accepts an envelope with jsonrpc:2.0 and an error key", () => {
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "x" } })).toBe(
      true,
    );
  });

  it("rejects an object missing both result and error", () => {
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1 })).toBe(false);
  });

  it("rejects a non-2.0 or non-object value", () => {
    expect(isJsonRpcResponse({ jsonrpc: "1.0", result: {} })).toBe(false);
    expect(isJsonRpcResponse(null)).toBe(false);
    expect(isJsonRpcResponse("not an object")).toBe(false);
  });
});

describe("tryParseJsonRpcError", () => {
  it("parses a well-formed {error:{code,message}} body", () => {
    const body = JSON.stringify({ error: { code: -32601, message: "Method not found" } });
    expect(tryParseJsonRpcError(body)).toEqual({
      code: -32601,
      message: "Method not found",
      data: undefined,
    });
  });

  it("carries data through when present", () => {
    const body = JSON.stringify({ error: { code: -1, message: "m", data: { extra: true } } });
    expect(tryParseJsonRpcError(body)).toEqual({ code: -1, message: "m", data: { extra: true } });
  });

  it("returns undefined for non-JSON, an absent body, or JSON missing the error shape", () => {
    expect(tryParseJsonRpcError(undefined)).toBeUndefined();
    expect(tryParseJsonRpcError("not json")).toBeUndefined();
    expect(tryParseJsonRpcError(JSON.stringify({ result: {} }))).toBeUndefined();
    expect(
      tryParseJsonRpcError(JSON.stringify({ error: { code: "not-a-number", message: "m" } })),
    ).toBeUndefined();
  });
});

describe("classifyRpcError", () => {
  it("maps the spec's example protocol-version-mismatch error specifically", () => {
    const err: JsonRpcErrorObject = {
      code: -32602,
      message: "Unsupported protocol version",
      data: { supported: ["2025-06-18", "2025-03-26"], requested: "1999-01-01" },
    };
    expect(classifyRpcError(err)).toEqual({
      kind: "protocol-mismatch",
      requested: "1999-01-01",
      supported: ["2025-06-18", "2025-03-26"],
      message: "Unsupported protocol version",
    });
  });

  it("falls back to the client's own PROTOCOL_VERSION when the error has no requested field", () => {
    const err: JsonRpcErrorObject = { code: -32602, message: "unsupported protocol version" };
    const result = classifyRpcError(err);
    expect(result.kind).toBe("protocol-mismatch");
  });

  it("maps any other error to a generic 'rpc-error' carrying code/message/data", () => {
    const err: JsonRpcErrorObject = { code: -32601, message: "Unknown tool", data: { tool: "x" } };
    expect(classifyRpcError(err)).toEqual({
      kind: "rpc-error",
      code: -32601,
      message: "Unknown tool",
      data: { tool: "x" },
    });
  });
});

describe("toResultFromJsonRpc", () => {
  it("maps an error envelope to a failed Result with the classified error", () => {
    const [value, error] = toResultFromJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Unknown tool" },
    });
    expect(value).toBeUndefined();
    expect(error).toEqual({
      kind: "rpc-error",
      code: -32601,
      message: "Unknown tool",
      data: undefined,
    });
  });

  it("maps a result envelope to a successful Result with the result payload", () => {
    const [value, error] = toResultFromJsonRpc({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    expect(error).toBeUndefined();
    expect(value).toEqual({ tools: [] });
  });
});

describe("classifyHttpErrorResponse", () => {
  it("prefers a JSON-RPC error body over the generic HTTP-status mapping", async () => {
    const response = new Response(
      JSON.stringify({ error: { code: -32000, message: "Server error" } }),
      { status: 500, statusText: "Internal Server Error" },
    );
    const error = await classifyHttpErrorResponse(response);
    expect(error).toEqual({
      kind: "rpc-error",
      code: -32000,
      message: "Server error",
      data: undefined,
    });
  });

  it("maps a non-JSON-RPC body to 'not-mcp-endpoint', including status and a truncated body", async () => {
    const response = new Response("<html>404</html>", { status: 404, statusText: "Not Found" });
    const error = await classifyHttpErrorResponse(response);
    expect(error).toEqual({
      kind: "not-mcp-endpoint",
      message: "Server responded 404 Not Found: <html>404</html>.",
    });
  });

  it("handles an empty body without throwing", async () => {
    const response = new Response("", { status: 500, statusText: "Internal Server Error" });
    const error = await classifyHttpErrorResponse(response);
    expect(error).toEqual({
      kind: "not-mcp-endpoint",
      message: "Server responded 500 Internal Server Error.",
    });
  });
});

describe("safeAuthMessage", () => {
  it("extracts a JSON-RPC error's message when present", async () => {
    const response = new Response(
      JSON.stringify({ error: { code: -1, message: "Unauthorized" } }),
      {
        status: 401,
      },
    );
    await expect(safeAuthMessage(response)).resolves.toBe("Unauthorized");
  });

  it("falls back to the truncated raw body when it isn't a JSON-RPC error", async () => {
    const response = new Response("plain text 401 page", { status: 401 });
    await expect(safeAuthMessage(response)).resolves.toBe("plain text 401 page");
  });

  it("falls back to a generic message for an empty body", async () => {
    const response = new Response("", { status: 401 });
    await expect(safeAuthMessage(response)).resolves.toBe("Authentication failed.");
  });
});

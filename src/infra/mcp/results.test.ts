// Tests for `listToolsViaSession`/`callToolViaSession` and the `tools/list`/
// `tools/call` result decoding they build on (card 88,
// boards/project-backlog/88-close-remaining-test-gaps.md). Exercised over a
// hand-built `McpWireSession` fake — decoding is transport-independent, so no
// fetch stub is needed here (see connect/streamable-http/legacy-sse tests for
// the transport layer itself).

import { describe, expect, it, vi } from "vitest";
import { fail, ok, type Result } from "../../domain/result";
import type { McpError } from "../../domain/tools";
import { callToolViaSession, listToolsViaSession } from "./results";
import type { McpWireSession } from "./session";

function fakeSession(request: McpWireSession["request"]): McpWireSession {
  return {
    connection: { protocolVersion: "2025-06-18" },
    request,
    notify: vi.fn(async () => undefined),
    close: vi.fn(),
  };
}

describe("listToolsViaSession", () => {
  it("returns every normalized tool from a single-page result", async () => {
    const request = vi.fn(
      async (): Promise<Result<unknown, McpError>> =>
        ok({
          tools: [
            {
              name: "search",
              title: "Search",
              description: "Find stuff",
              inputSchema: { type: "object" },
            },
            { name: "fetch" },
          ],
        }),
    );
    const result = await listToolsViaSession(fakeSession(request));
    expect(result).toEqual([
      [
        {
          name: "search",
          title: "Search",
          description: "Find stuff",
          inputSchema: { type: "object" },
          outputSchema: undefined,
          annotations: undefined,
        },
        {
          name: "fetch",
          title: undefined,
          description: undefined,
          inputSchema: undefined,
          outputSchema: undefined,
          annotations: undefined,
        },
      ],
      undefined,
    ]);
  });

  it("follows nextCursor across multiple pages and concatenates them in order", async () => {
    const request = vi.fn(
      async (_method: string, params?: unknown): Promise<Result<unknown, McpError>> => {
        const cursor = (params as { cursor?: string } | undefined)?.cursor;
        if (!cursor) return ok({ tools: [{ name: "a" }], nextCursor: "page2" });
        if (cursor === "page2") return ok({ tools: [{ name: "b" }], nextCursor: "page3" });
        return ok({ tools: [{ name: "c" }] });
      },
    );
    const [value, error] = await listToolsViaSession(fakeSession(request));
    expect(error).toBeUndefined();
    expect(value?.map((t) => t.name)).toEqual(["a", "b", "c"]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("a request-level failure (e.g. rpc-error) short-circuits pagination and is returned as-is", async () => {
    const request = vi.fn(
      async (): Promise<Result<unknown, McpError>> =>
        fail({ kind: "rpc-error", code: -32601, message: "Method not found" }),
    );
    const result = await listToolsViaSession(fakeSession(request));
    expect(result).toEqual([
      undefined,
      { kind: "rpc-error", code: -32601, message: "Method not found" },
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  describe("chaos: malformed tools/list results", () => {
    it("a result missing the tools array entirely is invalid-response", async () => {
      const request = vi.fn(async (): Promise<Result<unknown, McpError>> => ok({ notTools: [] }));
      const [, error] = await listToolsViaSession(fakeSession(request));
      expect(error?.kind).toBe("invalid-response");
    });

    it("a non-object result is invalid-response", async () => {
      const request = vi.fn(async (): Promise<Result<unknown, McpError>> => ok("not an object"));
      const [, error] = await listToolsViaSession(fakeSession(request));
      expect(error?.kind).toBe("invalid-response");
    });

    it("individual malformed tool entries (missing/empty name, non-object) are dropped, valid ones kept", async () => {
      const request = vi.fn(
        async (): Promise<Result<unknown, McpError>> =>
          ok({
            tools: [
              { name: "good" },
              { title: "no name field" },
              { name: "" }, // empty name
              "just a string",
              null,
              42,
            ],
          }),
      );
      const [value, error] = await listToolsViaSession(fakeSession(request));
      expect(error).toBeUndefined();
      expect(value?.map((t) => t.name)).toEqual(["good"]);
    });

    it("a server whose nextCursor never terminates is bounded at MAX_PAGES rather than looping forever", async () => {
      let calls = 0;
      const request = vi.fn(async (): Promise<Result<unknown, McpError>> => {
        calls++;
        return ok({ tools: [{ name: `t${calls}` }], nextCursor: "always-more" });
      });
      const [value, error] = await listToolsViaSession(fakeSession(request));
      expect(error).toBeUndefined();
      expect(calls).toBe(50); // MAX_PAGES
      expect(value).toHaveLength(50);
    });
  });
});

describe("callToolViaSession", () => {
  it("sends the tool name and arguments, defaulting arguments to {} when omitted", async () => {
    const request = vi.fn(async (): Promise<Result<unknown, McpError>> => ok({ content: [] }));
    await callToolViaSession(fakeSession(request), "myTool", undefined);
    expect(request).toHaveBeenCalledWith("tools/call", { name: "myTool", arguments: {} });

    await callToolViaSession(fakeSession(request), "myTool", { a: 1 });
    expect(request).toHaveBeenCalledWith("tools/call", { name: "myTool", arguments: { a: 1 } });
  });

  it("a request-level failure is returned as-is, never reaching result parsing", async () => {
    const request = vi.fn(
      async (): Promise<Result<unknown, McpError>> =>
        fail({ kind: "auth", status: 401, message: "expired" }),
    );
    const result = await callToolViaSession(fakeSession(request), "myTool", {});
    expect(result).toEqual([undefined, { kind: "auth", status: 401, message: "expired" }]);
  });

  it("isError: true is a TOOL-level failure, still resolved as a value per the spec's two-tier error model", async () => {
    const request = vi.fn(
      async (): Promise<Result<unknown, McpError>> =>
        ok({ content: [{ type: "text", text: "boom" }], isError: true }),
    );
    const result = await callToolViaSession(fakeSession(request), "myTool", {});
    expect(result).toEqual([
      {
        content: [{ type: "text", text: "boom" }],
        structuredContent: undefined,
        isError: true,
      },
      undefined,
    ]);
  });

  it("a non-boolean isError is coerced to false rather than propagated", async () => {
    const request = vi.fn(
      async (): Promise<Result<unknown, McpError>> => ok({ content: [], isError: "yes" }),
    );
    const [value, error] = await callToolViaSession(fakeSession(request), "myTool", {});
    expect(error).toBeUndefined();
    expect(value?.isError).toBe(false);
  });

  it("structuredContent, when a record, is carried through untouched", async () => {
    const request = vi.fn(
      async (): Promise<Result<unknown, McpError>> =>
        ok({ content: [], structuredContent: { rows: [1, 2, 3] } }),
    );
    const [value, error] = await callToolViaSession(fakeSession(request), "myTool", {});
    expect(error).toBeUndefined();
    expect(value?.structuredContent).toEqual({ rows: [1, 2, 3] });
  });

  it("a non-object structuredContent is dropped rather than passed through", async () => {
    const request = vi.fn(
      async (): Promise<Result<unknown, McpError>> =>
        ok({ content: [], structuredContent: "not an object" }),
    );
    const [value, error] = await callToolViaSession(fakeSession(request), "myTool", {});
    expect(error).toBeUndefined();
    expect(value?.structuredContent).toBeUndefined();
  });

  describe("chaos: malformed tools/call results", () => {
    it("a result missing the content array entirely is invalid-response", async () => {
      const request = vi.fn(async (): Promise<Result<unknown, McpError>> => ok({ isError: false }));
      const [, error] = await callToolViaSession(fakeSession(request), "myTool", {});
      expect(error?.kind).toBe("invalid-response");
    });

    it("a non-object result is invalid-response", async () => {
      const request = vi.fn(async (): Promise<Result<unknown, McpError>> => ok(null));
      const [, error] = await callToolViaSession(fakeSession(request), "myTool", {});
      expect(error?.kind).toBe("invalid-response");
    });
  });

  describe("content item normalization", () => {
    it.each([
      ["text", { type: "text", text: "hi" }, { type: "text", text: "hi" }],
      [
        "image",
        { type: "image", data: "base64", mimeType: "image/png" },
        { type: "image", data: "base64", mimeType: "image/png" },
      ],
      [
        "audio",
        { type: "audio", data: "base64", mimeType: "audio/wav" },
        { type: "audio", data: "base64", mimeType: "audio/wav" },
      ],
      [
        "resource_link",
        {
          type: "resource_link",
          uri: "file:///a",
          name: "A",
          description: "desc",
          mimeType: "text/plain",
        },
        {
          type: "resource_link",
          uri: "file:///a",
          name: "A",
          description: "desc",
          mimeType: "text/plain",
        },
      ],
      [
        "resource_link (minimal)",
        { type: "resource_link", uri: "file:///a" },
        {
          type: "resource_link",
          uri: "file:///a",
          name: undefined,
          description: undefined,
          mimeType: undefined,
        },
      ],
      [
        "resource",
        {
          type: "resource",
          resource: { uri: "file:///b", mimeType: "text/plain", text: "hi", blob: undefined },
        },
        {
          type: "resource",
          resource: { uri: "file:///b", mimeType: "text/plain", text: "hi", blob: undefined },
        },
      ],
    ])("a well-formed %s content item is normalized as-is", async (_label, raw, expected) => {
      const request = vi.fn(async (): Promise<Result<unknown, McpError>> => ok({ content: [raw] }));
      const [value, error] = await callToolViaSession(fakeSession(request), "myTool", {});
      expect(error).toBeUndefined();
      expect(value?.content).toEqual([expected]);
    });

    describe("chaos: malformed content items fall back to a raw-JSON text item, never dropped", () => {
      it.each([
        ["an unknown type", { type: "video", data: "x" }],
        ["text with a non-string text field", { type: "text", text: 123 }],
        ["image missing mimeType", { type: "image", data: "x" }],
        ["audio missing data", { type: "audio", mimeType: "audio/wav" }],
        ["resource_link missing uri", { type: "resource_link", name: "A" }],
        ["resource missing resource.uri", { type: "resource", resource: { text: "hi" } }],
        ["a bare string instead of an object", "just a string"],
        ["a number instead of an object", 42],
        ["null", null],
      ])("%s", async (_label, raw) => {
        const request = vi.fn(
          async (): Promise<Result<unknown, McpError>> => ok({ content: [raw] }),
        );
        const [value, error] = await callToolViaSession(fakeSession(request), "myTool", {});
        expect(error).toBeUndefined();
        expect(value?.content).toEqual([{ type: "text", text: JSON.stringify(raw) }]);
      });
    });
  });
});

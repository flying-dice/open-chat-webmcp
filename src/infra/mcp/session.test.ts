// Tests for `validateInitializeResult`/`initializeParams` — the `initialize`
// handshake validation shared by both HTTP transports (card 88,
// boards/project-backlog/88-close-remaining-test-gaps.md).

import { describe, expect, it } from "vitest";
import { initializeParams, validateInitializeResult } from "./session";
import type { JsonRpcResponseMsg } from "./json-rpc";

function response(overrides: Partial<JsonRpcResponseMsg> = {}): JsonRpcResponseMsg {
  return { jsonrpc: "2.0", id: 1, ...overrides };
}

describe("initializeParams", () => {
  it("carries the protocol version, empty capabilities, and the given clientInfo", () => {
    const params = initializeParams({ name: "test-client", version: "1.2.3" });
    expect(params).toEqual({
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.2.3" },
    });
  });
});

describe("validateInitializeResult", () => {
  it("a well-formed result with the current protocol version resolves ok, with serverInfo and instructions normalized", () => {
    const result = validateInitializeResult(
      response({
        result: {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "Acme MCP", title: "Acme", version: "9.9" },
          instructions: "Be nice.",
        },
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "Acme MCP", title: "Acme", version: "9.9" },
        instructions: "Be nice.",
      },
    });
  });

  it.each([["2025-03-26"], ["2024-11-05"]])(
    "a server negotiating down to a supported earlier version (%s) still resolves ok",
    (version) => {
      const result = validateInitializeResult(response({ result: { protocolVersion: version } }));
      expect(result).toEqual({
        ok: true,
        value: { protocolVersion: version, serverInfo: undefined, instructions: undefined },
      });
    },
  );

  it("a JSON-RPC error object on the initialize response is classified rather than treated as a result", () => {
    const result = validateInitializeResult(
      response({ error: { code: -32601, message: "Method not found" } }),
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "rpc-error", code: -32601, message: "Method not found", data: undefined },
    });
  });

  it("the spec's documented unsupported-protocol-version error shape is classified as protocol-mismatch, not a generic rpc-error", () => {
    const result = validateInitializeResult(
      response({
        error: {
          code: -32602,
          message: "Unsupported protocol version",
          data: { supported: ["2025-06-18"], requested: "1999-01-01" },
        },
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "protocol-mismatch",
        requested: "1999-01-01",
        supported: ["2025-06-18"],
        message: "Unsupported protocol version",
      },
    });
  });

  describe("chaos: malformed result payloads", () => {
    it("a result that isn't an object at all is invalid-response", () => {
      const result = validateInitializeResult(response({ result: "not an object" }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("invalid-response");
    });

    it("a result missing protocolVersion entirely is invalid-response", () => {
      const result = validateInitializeResult(response({ result: { serverInfo: { name: "x" } } }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("invalid-response");
    });

    it("protocolVersion present but the wrong type is invalid-response, not silently coerced", () => {
      const result = validateInitializeResult(response({ result: { protocolVersion: 20250618 } }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("invalid-response");
    });

    it("a protocolVersion this client does not recognize at all is protocol-mismatch, naming what it requested and what it supports", () => {
      const result = validateInitializeResult(response({ result: { protocolVersion: "1999-01-01" } }));
      expect(result).toEqual({
        ok: false,
        error: {
          kind: "protocol-mismatch",
          requested: "2025-06-18",
          supported: ["2025-06-18", "2025-03-26", "2024-11-05"],
          message:
            'Server negotiated protocol version "1999-01-01", which this client does not support (supports 2025-06-18, 2025-03-26, 2024-11-05).',
        },
      });
    });

    it("a malformed serverInfo (missing name) is dropped rather than failing the whole handshake", () => {
      const result = validateInitializeResult(
        response({ result: { protocolVersion: "2025-06-18", serverInfo: { title: "no name here" } } }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.serverInfo).toBeUndefined();
    });

    it("a non-object serverInfo is dropped, not thrown on", () => {
      const result = validateInitializeResult(
        response({ result: { protocolVersion: "2025-06-18", serverInfo: "Acme" } }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.serverInfo).toBeUndefined();
    });

    it("an instructions field of the wrong type is dropped, not coerced to a string", () => {
      const result = validateInitializeResult(
        response({ result: { protocolVersion: "2025-06-18", instructions: 12345 } }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.instructions).toBeUndefined();
    });
  });
});

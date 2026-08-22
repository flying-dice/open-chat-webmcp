// Tests for the MCP error/result vocabulary (card 94,
// decisions/34-errors-as-values.md): that `describeMcpError` covers every
// `McpError` member (including the four card 94 added — discovery-absent,
// registration-rejected, refresh-expired, user-cancelled), and that
// `Result<T, McpError>` narrows the same way the shared kernel's own tests
// (src/domain/result.test.ts) prove it does generically — restated here
// against the DOMAIN's own vocabulary rather than the kernel's stand-in
// `TestError`, since a narrowing regression specific to how `McpError` is
// shaped (e.g. a member with no extra fields, like `"aborted"`/
// `"user-cancelled"`) is exactly the kind of thing a generic test could miss.

import { describe, expect, it } from "vitest";
import type { Result } from "../result";
import { describeMcpError, type McpError } from "./types";

async function probe(kind: McpError["kind"]): Promise<Result<string, McpError>> {
  const error: McpError = kindToError(kind);
  return [undefined, error];
}

function kindToError(kind: McpError["kind"]): McpError {
  switch (kind) {
    case "unreachable":
    case "timeout":
    case "not-mcp-endpoint":
    case "invalid-response":
    case "permission":
    case "discovery-absent":
    case "registration-rejected":
    case "refresh-expired":
      return { kind, message: "test" };
    case "aborted":
    case "user-cancelled":
      return { kind };
    case "auth":
      return { kind, message: "test" };
    case "protocol-mismatch":
      return { kind, requested: "2025-06-18", message: "test" };
    case "rpc-error":
      return { kind, code: -32000, message: "test" };
  }
}

describe("describeMcpError — every McpError kind produces non-empty, credential-free copy", () => {
  const kinds: McpError["kind"][] = [
    "unreachable",
    "timeout",
    "aborted",
    "auth",
    "not-mcp-endpoint",
    "protocol-mismatch",
    "rpc-error",
    "invalid-response",
    "permission",
    "discovery-absent",
    "registration-rejected",
    "refresh-expired",
    "user-cancelled",
  ];

  it.each(kinds)("describes kind %s", (kind) => {
    const message = describeMcpError(kindToError(kind));
    expect(message.length).toBeGreaterThan(0);
  });

  it("card 94's four OAuth-specific kinds each get DISTINCT copy from one another and from the generic 'auth' kind", () => {
    const descriptions = new Set([
      describeMcpError({ kind: "auth", message: "m" }),
      describeMcpError({ kind: "discovery-absent", message: "m" }),
      describeMcpError({ kind: "registration-rejected", message: "m" }),
      describeMcpError({ kind: "refresh-expired", message: "m" }),
      describeMcpError({ kind: "user-cancelled" }),
    ]);
    expect(descriptions.size).toBe(5);
  });
});

describe("Result<T, McpError> narrowing (mirrors src/domain/result.test.ts, against the domain's own vocabulary)", () => {
  it("`if (err)` narrows the error side to McpError and the value side to T", async () => {
    const [value, err] = await probe("refresh-expired");
    if (!err) throw new Error("expected a failure");
    // Typed as McpError here — `.kind` resolves without a cast.
    expect(err.kind).toBe("refresh-expired");
    expect(value).toBeUndefined();
  });

  it("narrows a no-extra-fields member (`user-cancelled`) the same as any other", async () => {
    const [, err] = await probe("user-cancelled");
    if (!err) throw new Error("expected a failure");
    expect(err.kind).toBe("user-cancelled");
    // @ts-expect-error `user-cancelled` carries no `message` — this member of the union has none.
    const noMessage: string = err.message;
    expect(noMessage).toBeUndefined();
  });
});

describe("Result<T, McpError> narrowing — negative cases (fail the typecheck if narrowing ever over-reaches)", () => {
  it("does NOT let the error be read as McpError before the error member is checked", async () => {
    const [, err] = await probe("timeout");
    // @ts-expect-error `err` is `McpError | undefined` until it is checked.
    const kind: string = err.kind;
    expect(kind).toBe("timeout");
  });

  it("does NOT let the value be used before the error member is checked", async () => {
    async function loadName(): Promise<Result<string, McpError>> {
      return ["ada", undefined];
    }
    const [value] = await loadName();
    // @ts-expect-error `value` is `string | undefined` until the error member is checked.
    const shouted: string = value.toUpperCase();
    expect(shouted).toBe("ADA");
  });
});

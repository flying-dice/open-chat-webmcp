import { describe, it, expect } from "vitest";
import { denyByDefaultApprovalRequester } from "./ports";
import type { ToolCall } from "../providers";

describe("denyByDefaultApprovalRequester", () => {
  it("always denies — the fail-safe default until a real approval UI is wired in (decisions/05)", async () => {
    const call: ToolCall = { id: "c1", name: "delete_everything", arguments: {} };
    await expect(denyByDefaultApprovalRequester({ call, tool: undefined })).resolves.toBe("denied");
  });
});

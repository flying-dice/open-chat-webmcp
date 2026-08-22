// Chaos coverage for src/sidepanel/stores/approvals.svelte.ts (card 88,
// boards/project-backlog/88-close-remaining-test-gaps.md,
// .claude/skills/chaos-monkey/SKILL.md): the module had no dedicated test
// file at all before this card — ApprovalCard.test.ts mocks it wholesale
// (see that file's own comment), so nothing exercised the real
// `approve`/`deny`/`dismissAllPending` state machine. This file drives the
// real module directly, no mocking.
//
// Scope, per the card: a decision (approve/deny) DELIVERED TWICE for the
// same request, and a decision arriving for a request that was already
// DISMISSED (e.g. the user hit Stop mid-turn). `settle()`
// (approvals.svelte.ts:206-212) is the seam both hinge on: it looks up the
// request's resolver by id and no-ops if it is already gone, which is what
// makes both of these safe rather than a double-resolve or a thrown error —
// this file's job is proving that stays true.
//
// State (`pendingList`, `resolvers`, the two skip-lists) is module-scope
// singleton state with no reset hook. Every request below uses its own
// unique tool name so tests can't pollute each other's skip-lists, and
// `dismissAllPending()` in `afterEach` clears anything a test left pending.

import { afterEach, describe, expect, it } from "vitest";
import type { ApprovalRequest } from "../../domain/chat";
import type { MergedTool } from "../../domain/tools";
import type { ToolCall } from "../../domain/providers";
import { approvals, approve, deny, dismissAllPending, requestApproval } from "./approvals.svelte";

afterEach(() => {
  dismissAllPending();
});

let callCounter = 0;
function pageRequest(name?: string): ApprovalRequest {
  callCounter += 1;
  return {
    call: {
      id: `call-${callCounter}`,
      name: name ?? `pageTool${callCounter}`,
      arguments: {},
    } as ToolCall,
    tool: undefined,
  };
}

function serverRequest(name?: string): { request: ApprovalRequest; tool: MergedTool } {
  callCounter += 1;
  const toolName = name ?? `serverTool${callCounter}`;
  const tool: MergedTool = {
    name: toolName,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    origin: { kind: "server", serverId: `srv-${callCounter}`, serverName: "Test Server" },
    call: async () => ({ ok: true, result: undefined }),
  };
  return {
    request: {
      call: { id: `call-${callCounter}`, name: toolName, arguments: {} } as ToolCall,
      tool,
    },
    tool,
  };
}

describe("baseline: one pending request settles exactly once", () => {
  it("approve() resolves the request's promise as 'approved' and removes it from pending", async () => {
    const req = pageRequest();
    const decision = requestApproval(req);
    expect(approvals.pending).toHaveLength(1);

    const id = approvals.pending[0]!.id;
    approve(id, false);

    await expect(decision).resolves.toBe("approved");
    expect(approvals.pending).toHaveLength(0);
  });

  it("deny() resolves the request's promise as 'denied' and removes it from pending", async () => {
    const req = pageRequest();
    const decision = requestApproval(req);
    const id = approvals.pending[0]!.id;

    deny(id);

    await expect(decision).resolves.toBe("denied");
    expect(approvals.pending).toHaveLength(0);
  });
});

describe("chaos: a decision delivered twice for the same request", () => {
  it("a second approve() for an id already approved is a silent no-op — the decision stays what it was, nothing throws", async () => {
    const req = pageRequest();
    const decision = requestApproval(req);
    const id = approvals.pending[0]!.id;

    approve(id, false);
    expect(() => approve(id, false)).not.toThrow();

    await expect(decision).resolves.toBe("approved"); // never flips, never resolves a second time
    expect(approvals.pending).toHaveLength(0);
  });

  it("deny() after approve() for the same id does not flip the already-settled decision", async () => {
    const req = pageRequest();
    const decision = requestApproval(req);
    const id = approvals.pending[0]!.id;

    approve(id, false);
    expect(() => deny(id)).not.toThrow();

    await expect(decision).resolves.toBe("approved");
  });

  it("approve() after deny() for the same id does not flip the already-settled decision", async () => {
    const req = pageRequest();
    const decision = requestApproval(req);
    const id = approvals.pending[0]!.id;

    deny(id);
    expect(() => approve(id, false)).not.toThrow();

    await expect(decision).resolves.toBe("denied");
  });

  it("a duplicate approve(id, remember: true) delivery is safe — no throw, no duplicate pendingList entry left behind", async () => {
    const { request } = serverRequest();
    const decision = requestApproval(request);
    const id = approvals.pending[0]!.id;

    approve(id, true);
    expect(() => approve(id, true)).not.toThrow(); // delivered twice — the second finds no resolver left and must not re-add to the skip list or crash

    await expect(decision).resolves.toBe("approved");
    expect(approvals.pending).toHaveLength(0);
  });

  it("two DIFFERENT requests settling out of order never cross-wire their decisions", async () => {
    const reqA = pageRequest("toolA");
    const decisionA = requestApproval(reqA);
    const reqB = pageRequest("toolB");
    const decisionB = requestApproval(reqB);
    expect(approvals.pending).toHaveLength(2);

    const idA = approvals.pending.find((p) => p.call.name === "toolA")!.id;
    const idB = approvals.pending.find((p) => p.call.name === "toolB")!.id;

    // Settle B first, then A — out of arrival order.
    deny(idB);
    approve(idA, false);

    await expect(decisionA).resolves.toBe("approved");
    await expect(decisionB).resolves.toBe("denied");
    expect(approvals.pending).toHaveLength(0);
  });
});

describe("chaos: a decision for a dismissed request", () => {
  it("approve() for an id dismissAllPending() already denied is a no-op — the decision stays 'denied'", async () => {
    const req = pageRequest();
    const decision = requestApproval(req);
    const id = approvals.pending[0]!.id;

    dismissAllPending();
    expect(approvals.pending).toHaveLength(0);

    expect(() => approve(id, false)).not.toThrow();
    await expect(decision).resolves.toBe("denied"); // never overwritten to "approved"
  });

  it("deny() for an already-dismissed id is a no-op — no throw, no re-adding to pending", async () => {
    const req = pageRequest();
    const decision = requestApproval(req);
    const id = approvals.pending[0]!.id;

    dismissAllPending();

    expect(() => deny(id)).not.toThrow();
    await expect(decision).resolves.toBe("denied");
    expect(approvals.pending).toHaveLength(0);
  });

  it("dismissing denies every pending request independently — none are left stuck, none affect each other's identity", async () => {
    const decisions = [pageRequest("t1"), pageRequest("t2"), pageRequest("t3")].map((r) =>
      requestApproval(r),
    );
    expect(approvals.pending).toHaveLength(3);

    dismissAllPending();

    expect(approvals.pending).toHaveLength(0);
    await expect(Promise.all(decisions)).resolves.toEqual(["denied", "denied", "denied"]);
  });

  it("dismissAllPending() with nothing pending is a safe no-op", () => {
    expect(approvals.pending).toHaveLength(0);
    expect(() => dismissAllPending()).not.toThrow();
    expect(approvals.pending).toHaveLength(0);
  });

  it("approve()/deny() for an id that was never a real pending request at all is a no-op, not a crash", () => {
    expect(() => approve("not-a-real-id", false)).not.toThrow();
    expect(() => deny("not-a-real-id")).not.toThrow();
    expect(approvals.pending).toHaveLength(0);
  });
});

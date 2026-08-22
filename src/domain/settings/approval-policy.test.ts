// Tests for decisions/05 (page-tool approval) and decisions/20 (per-source
// approval policy), landed in ./approval-policy.ts (card 77).
//
// Per the file's own doc comment, `pageToolAutoRuns` and `serverToolAutoRuns`
// share NO logic — decision 20 requires the two rules to be able to drift
// independently without touching each other. So this suite tests them as two
// fully separate matrices rather than deriving one from the other, and never
// calls one to stand in for the other.
//
// No platform mocks: `SettingsStore` is faked in-memory against the port
// interface only.

import { describe, expect, it, test, vi } from "vitest";
import { fail, ok } from "../result";
import { StorageError } from "../storage";
import {
  type ApprovalPolicy,
  type ApprovalPolicyGate,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_MCP_APPROVAL_POLICY,
  type McpApprovalPolicy,
  type SettingsStore,
  type ToolApprovalSubject,
  createApprovalPolicyGate,
  isApprovalPolicy,
  isMcpApprovalPolicy,
  pageToolAutoRuns,
  serverToolAutoRuns,
} from "./approval-policy";

// ---------------------------------------------------------------------------
// Defaults and validators
// ---------------------------------------------------------------------------

describe("DEFAULT_APPROVAL_POLICY", () => {
  it("is 'default' — the readOnlyHint-driven page rule", () => {
    expect(DEFAULT_APPROVAL_POLICY).toBe("default");
  });
});

describe("DEFAULT_MCP_APPROVAL_POLICY", () => {
  it("is 'always-confirm' — the stricter server default (decision 20)", () => {
    expect(DEFAULT_MCP_APPROVAL_POLICY).toBe("always-confirm");
  });
});

describe("isApprovalPolicy", () => {
  test.each([["default"], ["always-confirm"], ["auto-run-all"]])("accepts %s", (value) => {
    expect(isApprovalPolicy(value)).toBe(true);
  });

  test.each([
    ["trust-read-only"], // valid MCP value, not a page value
    ["Default"],
    [""],
    [undefined],
    [null],
    [42],
    [{}],
  ])("rejects %s", (value) => {
    expect(isApprovalPolicy(value)).toBe(false);
  });
});

describe("isMcpApprovalPolicy", () => {
  test.each([["always-confirm"], ["trust-read-only"], ["auto-run-all"]])("accepts %s", (value) => {
    expect(isMcpApprovalPolicy(value)).toBe(true);
  });

  test.each([
    ["default"], // valid page value, not an MCP value
    ["Always-Confirm"],
    [""],
    [undefined],
    [null],
    [42],
    [{}],
  ])("rejects %s", (value) => {
    expect(isMcpApprovalPolicy(value)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pageToolAutoRuns — decision 05/17's PAGE-tool rule
// ---------------------------------------------------------------------------

describe("pageToolAutoRuns", () => {
  test.each<[ApprovalPolicy, boolean, boolean]>([
    // policy               readOnlyHint  expected
    ["default", true, true],
    ["default", false, false],
    ["always-confirm", true, false],
    ["always-confirm", false, false],
    ["auto-run-all", true, true],
    ["auto-run-all", false, true],
  ])("policy=%s, readOnly=%s -> auto-runs=%s", (policy, readOnly, expected) => {
    expect(pageToolAutoRuns(policy, readOnly)).toBe(expected);
  });

  it("'always-confirm' overrides a readOnlyHint tool — the one case where the annotation is not enough", () => {
    expect(pageToolAutoRuns("always-confirm", true)).toBe(false);
  });

  it("'default' treats a mutating tool as needing confirmation even under readOnlyHint=false", () => {
    expect(pageToolAutoRuns("default", false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// serverToolAutoRuns — decision 20's SERVER-tool rule, independent of the
// page rule above
// ---------------------------------------------------------------------------

describe("serverToolAutoRuns", () => {
  test.each<[McpApprovalPolicy, boolean, boolean]>([
    // policy               readOnlyHint  expected
    ["always-confirm", true, false],
    ["always-confirm", false, false],
    ["trust-read-only", true, true],
    ["trust-read-only", false, false],
    ["auto-run-all", true, true],
    ["auto-run-all", false, true],
  ])("policy=%s, readOnly=%s -> auto-runs=%s", (policy, readOnly, expected) => {
    expect(serverToolAutoRuns(policy, readOnly)).toBe(expected);
  });

  it("'always-confirm' asks even for a readOnlyHint tool — a server's self-assertion is not enough alone", () => {
    expect(serverToolAutoRuns("always-confirm", true)).toBe(false);
  });

  it("'trust-read-only' is the opt-in page-style rule, not the default", () => {
    expect(serverToolAutoRuns("trust-read-only", true)).toBe(true);
    expect(serverToolAutoRuns("trust-read-only", false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The two rules never agree by accident — same policy string, same
// readOnlyHint, but each function reads its OWN policy type, so this checks
// they are not secretly the same function under two names.
// ---------------------------------------------------------------------------

describe("page and server rules are independent", () => {
  it("differ on the shared 'always-confirm' policy name with readOnlyHint=true: page still asks too, but for a different reason (no auto-run-all override in play)", () => {
    // Both currently return false here, but via entirely separate code
    // paths — this pins that neither rule was collapsed into a shared
    // `shouldAutoRun(policy, readOnly)` that the two barrels merely alias.
    expect(pageToolAutoRuns("always-confirm", true)).toBe(false);
    expect(serverToolAutoRuns("always-confirm", true)).toBe(false);
  });

  it("differ on 'auto-run-all' vs 'trust-read-only' with readOnlyHint=false: server's opt-in rule refuses, unlike its own auto-run-all", () => {
    expect(serverToolAutoRuns("auto-run-all", false)).toBe(true);
    expect(serverToolAutoRuns("trust-read-only", false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// untrustedContentHint — orthogonal to the auto-run decision.
//
// Neither pure rule even accepts an annotations object — only a bare
// `readOnlyHint: boolean` — so untrustedContentHint cannot influence them by
// construction. The only place both hints travel together is
// `ToolApprovalSubject`/the gate below, where `mayAutoRun` reads
// `annotations.readOnlyHint` and nothing else off `annotations`. These tests
// pin that untrusted content, however marked, never changes whether a call
// is confirmed via this policy layer, for both a read-only and a mutating
// tool.
// ---------------------------------------------------------------------------

describe("untrustedContentHint does not affect the auto-run decision", () => {
  function pageSubject(
    readOnlyHint: boolean,
    untrustedContentHint: boolean | undefined,
  ): ToolApprovalSubject {
    return { origin: { kind: "page" }, annotations: { readOnlyHint, untrustedContentHint } };
  }

  function serverSubject(
    readOnlyHint: boolean,
    untrustedContentHint: boolean | undefined,
  ): ToolApprovalSubject {
    return {
      origin: { kind: "server", serverId: "srv-1", serverName: "Test Server" },
      annotations: { readOnlyHint, untrustedContentHint },
    };
  }

  test.each<[boolean, boolean | undefined]>([
    [true, true],
    [true, false],
    [true, undefined],
    [false, true],
    [false, false],
    [false, undefined],
  ])(
    "page tool, readOnly=%s, untrustedContentHint=%s: gate result matches the pure rule regardless",
    async (readOnly, untrusted) => {
      const store = new FakeSettingsStore("default", "always-confirm");
      const gate = createApprovalPolicyGate(store);
      const result = await gate.mayAutoRun(pageSubject(readOnly, untrusted));
      expect(result).toBe(pageToolAutoRuns("default", readOnly));
    },
  );

  test.each<[boolean, boolean | undefined]>([
    [true, true],
    [true, false],
    [true, undefined],
    [false, true],
    [false, false],
    [false, undefined],
  ])(
    "server tool, readOnly=%s, untrustedContentHint=%s: gate result matches the pure rule regardless",
    async (readOnly, untrusted) => {
      const store = new FakeSettingsStore("always-confirm", "trust-read-only");
      const gate = createApprovalPolicyGate(store);
      const result = await gate.mayAutoRun(serverSubject(readOnly, untrusted));
      expect(result).toBe(serverToolAutoRuns("trust-read-only", readOnly));
    },
  );
});

// ---------------------------------------------------------------------------
// createApprovalPolicyGate — the thin async dispatcher
// ---------------------------------------------------------------------------

/**
 * Errors this fake should hand back instead of answering a read, keyed by
 * method name — how the "policy read fails closed" tests below are set up
 * without a second, divergent fake just for the unhappy path.
 */
interface FakeSettingsStoreFailures {
  getApprovalPolicy?: StorageError;
  getMcpApprovalPolicy?: StorageError;
}

class FakeSettingsStore implements SettingsStore {
  getApprovalPolicyCalls = 0;
  getMcpApprovalPolicyCalls = 0;

  constructor(
    public policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY,
    public mcpPolicy: McpApprovalPolicy = DEFAULT_MCP_APPROVAL_POLICY,
    private readonly failures: FakeSettingsStoreFailures = {},
  ) {}

  async getApprovalPolicy() {
    this.getApprovalPolicyCalls++;
    if (this.failures.getApprovalPolicy) return fail(this.failures.getApprovalPolicy);
    return ok(this.policy);
  }

  async setApprovalPolicy(policy: ApprovalPolicy) {
    this.policy = policy;
    return ok();
  }

  onApprovalPolicyChange(): () => void {
    return () => {};
  }

  async getMcpApprovalPolicy() {
    this.getMcpApprovalPolicyCalls++;
    if (this.failures.getMcpApprovalPolicy) return fail(this.failures.getMcpApprovalPolicy);
    return ok(this.mcpPolicy);
  }

  async setMcpApprovalPolicy(policy: McpApprovalPolicy) {
    this.mcpPolicy = policy;
    return ok();
  }

  onMcpApprovalPolicyChange(): () => void {
    return () => {};
  }
}

function pageTool(readOnlyHint: boolean): ToolApprovalSubject {
  return { origin: { kind: "page" }, annotations: { readOnlyHint } };
}

function serverTool(readOnlyHint: boolean): ToolApprovalSubject {
  return {
    origin: { kind: "server", serverId: "srv-1", serverName: "Test Server" },
    annotations: { readOnlyHint },
  };
}

describe("createApprovalPolicyGate", () => {
  it("dispatches a page-origin tool to the page policy and rule", async () => {
    const store = new FakeSettingsStore("auto-run-all", "always-confirm");
    const gate = createApprovalPolicyGate(store);

    await expect(gate.mayAutoRun(pageTool(false))).resolves.toBe(true);
    expect(store.getApprovalPolicyCalls).toBe(1);
    expect(store.getMcpApprovalPolicyCalls).toBe(0);
  });

  it("dispatches a server-origin tool to the MCP policy and rule", async () => {
    const store = new FakeSettingsStore("always-confirm", "auto-run-all");
    const gate = createApprovalPolicyGate(store);

    await expect(gate.mayAutoRun(serverTool(false))).resolves.toBe(true);
    expect(store.getMcpApprovalPolicyCalls).toBe(1);
    expect(store.getApprovalPolicyCalls).toBe(0);
  });

  it("judges an unresolved (undefined) tool the page way, treating it as not read-only", async () => {
    const store = new FakeSettingsStore("default", "auto-run-all");
    const gate = createApprovalPolicyGate(store);

    // page policy "default" + readOnly=false -> confirm, matching an
    // unannotated/unknown call being treated as mutating, never as safe.
    await expect(gate.mayAutoRun(undefined)).resolves.toBe(false);
    expect(store.getApprovalPolicyCalls).toBe(1);
    expect(store.getMcpApprovalPolicyCalls).toBe(0);
  });

  it("an undefined tool auto-runs under page policy 'auto-run-all', still via the page rule", async () => {
    const store = new FakeSettingsStore("auto-run-all", "always-confirm");
    const gate = createApprovalPolicyGate(store);

    await expect(gate.mayAutoRun(undefined)).resolves.toBe(true);
  });

  it("treats an unset readOnlyHint (annotations without the key) as not read-only, not as safe", async () => {
    const store = new FakeSettingsStore("default", "always-confirm");
    const gate = createApprovalPolicyGate(store);

    const subject: ToolApprovalSubject = { origin: { kind: "page" }, annotations: {} };
    await expect(gate.mayAutoRun(subject)).resolves.toBe(false);
  });

  it("re-reads the store on every call rather than caching the policy from the first call", async () => {
    const store = new FakeSettingsStore("always-confirm", "always-confirm");
    const gate = createApprovalPolicyGate(store);

    // First call under "always-confirm": a read-only page tool still asks.
    await expect(gate.mayAutoRun(pageTool(true))).resolves.toBe(false);
    expect(store.getApprovalPolicyCalls).toBe(1);

    // Policy changes mid-session (another open options tab / synced value) —
    // NOT observed by the gate until the next call.
    store.policy = "auto-run-all";

    await expect(gate.mayAutoRun(pageTool(true))).resolves.toBe(true);
    expect(store.getApprovalPolicyCalls).toBe(2);
  });

  it("re-reads the MCP store on every call the same way", async () => {
    const store = new FakeSettingsStore("always-confirm", "always-confirm");
    const gate = createApprovalPolicyGate(store);

    await expect(gate.mayAutoRun(serverTool(true))).resolves.toBe(false);
    expect(store.getMcpApprovalPolicyCalls).toBe(1);

    store.mcpPolicy = "trust-read-only";

    await expect(gate.mayAutoRun(serverTool(true))).resolves.toBe(true);
    expect(store.getMcpApprovalPolicyCalls).toBe(2);

    // A page-policy change never fires for a server call, and vice versa —
    // decision 20's isolation, pinned at the gate level too.
    expect(store.getApprovalPolicyCalls).toBe(0);
  });

  it("returns an ApprovalPolicyGate satisfying its own interface shape", () => {
    const gate: ApprovalPolicyGate = createApprovalPolicyGate(new FakeSettingsStore());
    expect(typeof gate.mayAutoRun).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// FAILS CLOSED (card 92, decisions/34-errors-as-values.md) — the one place
// this port's own doc comment insists on a plain `false` rather than a
// `Result`: when the underlying store cannot be read at all, there is no
// defensible answer other than "ask the human", and the gate must say so
// through `reportReadFailure` rather than let the failure travel silently.
// ---------------------------------------------------------------------------

describe("createApprovalPolicyGate — fails closed on an unreadable policy", () => {
  it("returns false for a page tool when the page policy read fails, even under 'auto-run-all'", async () => {
    const boom = new StorageError("Unavailable", "the store did not answer");
    // The stored value itself would auto-run everything — pinning that it is
    // the READ failing, not the policy value, that drives the `false` here.
    const store = new FakeSettingsStore("auto-run-all", "auto-run-all", {
      getApprovalPolicy: boom,
    });
    const reportReadFailure = vi.fn();
    const gate = createApprovalPolicyGate(store, reportReadFailure);

    await expect(gate.mayAutoRun(pageTool(true))).resolves.toBe(false);
    expect(reportReadFailure).toHaveBeenCalledExactlyOnceWith(expect.any(String), boom);
  });

  it("returns false for a server tool when the MCP policy read fails, even under 'auto-run-all'", async () => {
    const boom = new StorageError("Unavailable", "the store did not answer");
    const store = new FakeSettingsStore("auto-run-all", "auto-run-all", {
      getMcpApprovalPolicy: boom,
    });
    const reportReadFailure = vi.fn();
    const gate = createApprovalPolicyGate(store, reportReadFailure);

    await expect(gate.mayAutoRun(serverTool(true))).resolves.toBe(false);
    expect(reportReadFailure).toHaveBeenCalledExactlyOnceWith(expect.any(String), boom);
  });

  it("an unresolved (undefined) tool is judged the page way, so a failing PAGE read still fails it closed", async () => {
    const boom = new StorageError("Unavailable", "the store did not answer");
    const store = new FakeSettingsStore("auto-run-all", "auto-run-all", {
      getApprovalPolicy: boom,
    });
    const reportReadFailure = vi.fn();
    const gate = createApprovalPolicyGate(store, reportReadFailure);

    await expect(gate.mayAutoRun(undefined)).resolves.toBe(false);
    expect(reportReadFailure).toHaveBeenCalledOnce();
  });

  it("defaults reportReadFailure to console.error when none is supplied", async () => {
    const boom = new StorageError("Unavailable", "the store did not answer");
    const store = new FakeSettingsStore("default", "always-confirm", { getApprovalPolicy: boom });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const gate = createApprovalPolicyGate(store);
      await expect(gate.mayAutoRun(pageTool(true))).resolves.toBe(false);
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(expect.any(String), boom);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("a failing MCP read never falls back to the page rule/policy — the two stay isolated even on failure (decision 20)", async () => {
    const boom = new StorageError("Unavailable", "the store did not answer");
    const store = new FakeSettingsStore("auto-run-all", "always-confirm", {
      getMcpApprovalPolicy: boom,
    });
    const reportReadFailure = vi.fn();
    const gate = createApprovalPolicyGate(store, reportReadFailure);

    await expect(gate.mayAutoRun(serverTool(true))).resolves.toBe(false);
    expect(store.getApprovalPolicyCalls).toBe(0);
  });
});

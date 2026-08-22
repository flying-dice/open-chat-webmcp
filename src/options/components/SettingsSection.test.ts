// Component tests for SettingsSection.svelte (card 84,
// decisions/30-vitest-test-pyramid.md's component tier). Drives the two
// approval-policy RadioGroups over src/options/testing/fake-services.ts's
// FAKE `OptionsServices` — no chrome.*, no real storage. See that module's
// header for why `initFakeOptionsServices` is called exactly ONCE per file
// (a `beforeAll`) rather than per test, and why NOT `vi.resetModules()`
// (it corrupts Svelte's internal module state and crashes any bits-ui
// component mounted afterward).
//
// decisions/20-approval-policy-is-per-tool-source.md is the reason almost
// every test here checks BOTH RadioGroups, not just the one it's nominally
// about: the page policy and the MCP-server policy must never cross-
// contaminate — changing one must never read, write, or visually affect the
// other.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import SettingsSection from "./SettingsSection.svelte";
import { createFakeOptionsServices, initFakeOptionsServices } from "../testing/fake-services";
import type { ApprovalPolicy, McpApprovalPolicy } from "../../domain/settings";

// @testing-library/svelte's auto-cleanup only registers when `beforeEach`/
// `afterEach` are Vitest GLOBALS (test.globals in vitest.config.ts, which
// this project deliberately doesn't set) — without this, every test's
// rendered tree accumulates in the DOM across the whole file, breaking
// `getByText`/`getById` lookups with "multiple elements found". Explicit
// per-file cleanup instead, same as McpServerForm.test.ts.
afterEach(() => {
  cleanup();
});

// The two "revert on write failure" tests below deliberately trigger a
// rejection inside `handlePolicyChange`/`handleMcpPolicyChange` that the
// component's `onValueChange={(next) => handlePolicyChange(...)}` wiring
// never awaits or catches (see the tests' own comment). Node's
// `unhandledRejection` detection runs on a LATER turn of the event loop
// than the `await waitFor(...)` in those tests settles on, so a listener
// scoped to just those `it`s (attach-then-detach around the click) can miss
// the event entirely and let it leak into whatever test runs next. Attached
// once for the whole file instead, filtered to exactly the expected
// message so any other unhandled rejection still fails the suite.
function onExpectedWriteFailureRejection(reason: unknown): void {
  if (reason instanceof Error && reason.message === "write failed") return;
  throw reason;
}
// `process` is a Node global (Vitest itself runs on Node even though this
// project is a jsdom test) — typed here as `unknown` and narrowed inline
// rather than reaching for `@types/node`, which tsconfig.app.json (a
// browser-targeted config, shared with the rest of this surface) doesn't
// include.
type NodeEventEmitterLike = {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
};
const nodeProcess = (globalThis as { process?: NodeEventEmitterLike }).process;
beforeAll(() => {
  nodeProcess?.on("unhandledRejection", onExpectedWriteFailureRejection);
});
afterAll(() => {
  nodeProcess?.off("unhandledRejection", onExpectedWriteFailureRejection);
});

describe("SettingsSection", () => {
  const services = createFakeOptionsServices();
  beforeAll(() => {
    initFakeOptionsServices(services);
  });

  beforeEach(() => {
    // Reset to the fake store's own defaults between tests — each test that
    // needs a different starting policy or write behaviour overrides the
    // relevant method below, BEFORE calling render().
    services.settings.getApprovalPolicy = async () => "default";
    services.settings.setApprovalPolicy = async () => undefined;
    services.settings.onApprovalPolicyChange = () => () => undefined;
    services.settings.getMcpApprovalPolicy = async () => "always-confirm";
    services.settings.setMcpApprovalPolicy = async () => undefined;
    services.settings.onMcpApprovalPolicyChange = () => () => undefined;
  });

  // Both RadioGroupItems render as `<button role="radio" id="...">`
  // (bits-ui, not a native `<input>`) with `aria-checked` reflecting
  // selection — see node_modules/bits-ui's RadioGroupItemState. Looking them
  // up by their component-assigned id keeps each assertion pinned to
  // exactly one group, which is the whole point of decision 20's tests.
  function pageRadio(value: ApprovalPolicy): HTMLElement {
    const el = document.getElementById(`approval-policy-${value}`);
    if (!el) throw new Error(`page policy radio not found: ${value}`);
    return el;
  }
  function mcpRadio(value: McpApprovalPolicy): HTMLElement {
    const el = document.getElementById(`mcp-approval-policy-${value}`);
    if (!el) throw new Error(`mcp policy radio not found: ${value}`);
    return el;
  }

  // ---------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------

  it("shows a loading state per card before its policy resolves, independently", async () => {
    let resolvePagePolicy!: (value: ApprovalPolicy) => void;
    let resolveMcpPolicy!: (value: McpApprovalPolicy) => void;
    services.settings.getApprovalPolicy = () =>
      new Promise((resolve) => {
        resolvePagePolicy = resolve;
      });
    services.settings.getMcpApprovalPolicy = () =>
      new Promise((resolve) => {
        resolveMcpPolicy = resolve;
      });

    render(SettingsSection);

    // Both cards start loading — neither policy has resolved yet.
    expect(screen.getAllByText("Loading…")).toHaveLength(2);

    resolvePagePolicy("default");
    await waitFor(() => expect(pageRadio("default")).toBeInTheDocument());
    // The MCP card's own promise is still unresolved — its loading state
    // must not have been affected by resolving the page policy's.
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(document.getElementById("mcp-approval-policy-always-confirm")).not.toBeInTheDocument();

    resolveMcpPolicy("always-confirm");
    await waitFor(() => expect(mcpRadio("always-confirm")).toBeInTheDocument());
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Reflects the store
  // ---------------------------------------------------------------------

  it("reflects both policies from the store once loaded, without cross-contamination", async () => {
    services.settings.getApprovalPolicy = async () => "always-confirm";
    services.settings.getMcpApprovalPolicy = async () => "trust-read-only";

    render(SettingsSection);

    await waitFor(() => expect(pageRadio("always-confirm")).toHaveAttribute("aria-checked", "true"));
    expect(pageRadio("default")).toHaveAttribute("aria-checked", "false");
    expect(pageRadio("auto-run-all")).toHaveAttribute("aria-checked", "false");

    await waitFor(() => expect(mcpRadio("trust-read-only")).toHaveAttribute("aria-checked", "true"));
    expect(mcpRadio("always-confirm")).toHaveAttribute("aria-checked", "false");
    expect(mcpRadio("auto-run-all")).toHaveAttribute("aria-checked", "false");
  });

  // ---------------------------------------------------------------------
  // Persist via the fake settings store (optimistic update)
  // ---------------------------------------------------------------------

  it("persists a page-policy change via setApprovalPolicy and never calls the MCP setter", async () => {
    services.settings.setApprovalPolicy = vi.fn(async () => undefined);
    services.settings.setMcpApprovalPolicy = vi.fn(async () => undefined);

    const user = userEvent.setup();
    render(SettingsSection);
    await waitFor(() => expect(pageRadio("default")).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expect(mcpRadio("always-confirm")).toHaveAttribute("aria-checked", "true"));

    await user.click(pageRadio("auto-run-all"));

    await waitFor(() => expect(pageRadio("auto-run-all")).toHaveAttribute("aria-checked", "true"));
    expect(pageRadio("default")).toHaveAttribute("aria-checked", "false");
    expect(services.settings.setApprovalPolicy).toHaveBeenCalledExactlyOnceWith("auto-run-all");
    expect(services.settings.setMcpApprovalPolicy).not.toHaveBeenCalled();

    // The MCP group is untouched by the page-policy click.
    expect(mcpRadio("always-confirm")).toHaveAttribute("aria-checked", "true");
  });

  it("persists an MCP-policy change via setMcpApprovalPolicy and never calls the page setter", async () => {
    services.settings.setApprovalPolicy = vi.fn(async () => undefined);
    services.settings.setMcpApprovalPolicy = vi.fn(async () => undefined);

    const user = userEvent.setup();
    render(SettingsSection);
    await waitFor(() => expect(pageRadio("default")).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expect(mcpRadio("always-confirm")).toHaveAttribute("aria-checked", "true"));

    await user.click(mcpRadio("trust-read-only"));

    await waitFor(() => expect(mcpRadio("trust-read-only")).toHaveAttribute("aria-checked", "true"));
    expect(mcpRadio("always-confirm")).toHaveAttribute("aria-checked", "false");
    expect(services.settings.setMcpApprovalPolicy).toHaveBeenCalledExactlyOnceWith("trust-read-only");
    expect(services.settings.setApprovalPolicy).not.toHaveBeenCalled();

    // The page group is untouched by the MCP-policy click.
    expect(pageRadio("default")).toHaveAttribute("aria-checked", "true");
  });

  // ---------------------------------------------------------------------
  // Revert on write failure
  // ---------------------------------------------------------------------
  //
  // handlePolicyChange applies the new value optimistically, then reverts
  // `policy`/`mcpPolicy` back to the previous value on a rejected write and
  // RE-THROWS. The component's `onValueChange={(next) =>
  // handlePolicyChange(...)}` callback never awaits or catches that
  // returned promise, so the rejection surfaces as a genuine unhandled
  // promise rejection rather than as something `userEvent.click`'s own
  // promise propagates — see this file's top-level
  // `onExpectedWriteFailureRejection` listener that absorbs exactly this.

  it("reverts the page policy to the previous selection when the write fails", async () => {
    services.settings.setApprovalPolicy = vi.fn(async () => {
      throw new Error("write failed");
    });

    const user = userEvent.setup();
    render(SettingsSection);
    await waitFor(() => expect(pageRadio("default")).toHaveAttribute("aria-checked", "true"));

    await user.click(pageRadio("auto-run-all"));

    // Reverts back to "default" once the rejected write settles.
    await waitFor(() => expect(pageRadio("default")).toHaveAttribute("aria-checked", "true"));
    expect(pageRadio("auto-run-all")).toHaveAttribute("aria-checked", "false");
  });

  it("reverts the MCP policy to the previous selection when the write fails", async () => {
    services.settings.setMcpApprovalPolicy = vi.fn(async () => {
      throw new Error("write failed");
    });

    const user = userEvent.setup();
    render(SettingsSection);
    await waitFor(() => expect(mcpRadio("always-confirm")).toHaveAttribute("aria-checked", "true"));

    await user.click(mcpRadio("trust-read-only"));

    // Reverts back to "always-confirm" once the rejected write settles.
    await waitFor(() => expect(mcpRadio("always-confirm")).toHaveAttribute("aria-checked", "true"));
    expect(mcpRadio("trust-read-only")).toHaveAttribute("aria-checked", "false");
  });

  // ---------------------------------------------------------------------
  // "Risk" badge
  // ---------------------------------------------------------------------

  it("shows a Risk badge next to Auto-run everything in both approval groups", async () => {
    render(SettingsSection);
    await waitFor(() => expect(pageRadio("default")).toBeInTheDocument());
    await waitFor(() => expect(mcpRadio("always-confirm")).toBeInTheDocument());

    expect(screen.getAllByText("Risk")).toHaveLength(2);
  });
});

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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import SettingsSection from "./SettingsSection.svelte";
import {
  createFakeOptionsServices,
  initFakeOptionsServices,
  storageFailure,
} from "../testing/fake-services";
import { ok, fail } from "../../domain/result";
import type { Result } from "../../domain/result";
import type { StorageError } from "../../domain/storage";
import type { ApprovalPolicy, McpApprovalPolicy } from "../../domain/settings";
import { m } from "../../paraglide/messages.js";

// @testing-library/svelte's auto-cleanup only registers when `beforeEach`/
// `afterEach` are Vitest GLOBALS (test.globals in vitest.config.ts, which
// this project deliberately doesn't set) — without this, every test's
// rendered tree accumulates in the DOM across the whole file, breaking
// `getByText`/`getById` lookups with "multiple elements found". Explicit
// per-file cleanup instead, same as McpServerForm.test.ts.
afterEach(() => {
  cleanup();
});

/*
 * REMOVED (card 95): this file's whole `process.on("unhandledRejection", …)`
 * apparatus, plus the `NodeEventEmitterLike` shim it needed to reach `process`
 * from a browser-targeted tsconfig.
 *
 * It existed because the two "revert on write failure" tests below drove a
 * component that RETHREW the failure from a promise nothing awaited — so the
 * only way to keep the suite green was to catch the resulting unhandled
 * rejection by message and swallow it. That the tests needed a global
 * exception filter to pass was the clearest possible statement that the
 * rethrow had no owner. Card 95 replaced both throws with an alert in the
 * section, and this scaffolding went with them.
 */

describe("SettingsSection", () => {
  const services = createFakeOptionsServices();
  beforeAll(() => {
    initFakeOptionsServices(services);
  });

  beforeEach(() => {
    // Reset to the fake store's own defaults between tests — each test that
    // needs a different starting policy or write behaviour overrides the
    // relevant method below, BEFORE calling render(). Card 92: every read/
    // write below now resolves a `Result`, so a "succeeds" default is
    // `ok(...)` rather than a bare value/`undefined`.
    services.settings.getApprovalPolicy = async () => ok("default");
    services.settings.setApprovalPolicy = async () => ok();
    services.settings.onApprovalPolicyChange = () => () => undefined;
    services.settings.getMcpApprovalPolicy = async () => ok("always-confirm");
    services.settings.setMcpApprovalPolicy = async () => ok();
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
    let resolvePagePolicy!: (value: Result<ApprovalPolicy, StorageError>) => void;
    let resolveMcpPolicy!: (value: Result<McpApprovalPolicy, StorageError>) => void;
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
    expect(screen.getAllByText(m.loadingLabel())).toHaveLength(2);

    resolvePagePolicy(ok("default"));
    await waitFor(() => expect(pageRadio("default")).toBeInTheDocument());
    // The MCP card's own promise is still unresolved — its loading state
    // must not have been affected by resolving the page policy's.
    expect(screen.getByText(m.loadingLabel())).toBeInTheDocument();
    expect(document.getElementById("mcp-approval-policy-always-confirm")).not.toBeInTheDocument();

    resolveMcpPolicy(ok("always-confirm"));
    await waitFor(() => expect(mcpRadio("always-confirm")).toBeInTheDocument());
    expect(screen.queryByText(m.loadingLabel())).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Reflects the store
  // ---------------------------------------------------------------------

  it("reflects both policies from the store once loaded, without cross-contamination", async () => {
    services.settings.getApprovalPolicy = async () => ok("always-confirm");
    services.settings.getMcpApprovalPolicy = async () => ok("trust-read-only");

    render(SettingsSection);

    await waitFor(() =>
      expect(pageRadio("always-confirm")).toHaveAttribute("aria-checked", "true"),
    );
    expect(pageRadio("default")).toHaveAttribute("aria-checked", "false");
    expect(pageRadio("auto-run-all")).toHaveAttribute("aria-checked", "false");

    await waitFor(() =>
      expect(mcpRadio("trust-read-only")).toHaveAttribute("aria-checked", "true"),
    );
    expect(mcpRadio("always-confirm")).toHaveAttribute("aria-checked", "false");
    expect(mcpRadio("auto-run-all")).toHaveAttribute("aria-checked", "false");
  });

  // ---------------------------------------------------------------------
  // Persist via the fake settings store (optimistic update)
  // ---------------------------------------------------------------------

  it("persists a page-policy change via setApprovalPolicy and never calls the MCP setter", async () => {
    services.settings.setApprovalPolicy = vi.fn(async () => ok());
    services.settings.setMcpApprovalPolicy = vi.fn(async () => ok());

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
    services.settings.setApprovalPolicy = vi.fn(async () => ok());
    services.settings.setMcpApprovalPolicy = vi.fn(async () => ok());

    const user = userEvent.setup();
    render(SettingsSection);
    await waitFor(() => expect(pageRadio("default")).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expect(mcpRadio("always-confirm")).toHaveAttribute("aria-checked", "true"));

    await user.click(mcpRadio("trust-read-only"));

    await waitFor(() =>
      expect(mcpRadio("trust-read-only")).toHaveAttribute("aria-checked", "true"),
    );
    expect(mcpRadio("always-confirm")).toHaveAttribute("aria-checked", "false");
    expect(services.settings.setMcpApprovalPolicy).toHaveBeenCalledExactlyOnceWith(
      "trust-read-only",
    );
    expect(services.settings.setApprovalPolicy).not.toHaveBeenCalled();

    // The page group is untouched by the MCP-policy click.
    expect(pageRadio("default")).toHaveAttribute("aria-checked", "true");
  });

  // ---------------------------------------------------------------------
  // Revert on write failure
  // ---------------------------------------------------------------------
  //
  // Card 92: `setApprovalPolicy`/`setMcpApprovalPolicy` no longer REJECT —
  // they resolve a `Result`, and the fake below returns `fail(storageFailure(...))`
  // to drive that path, same as the real adapter would on a genuine storage
  // fault. `handlePolicyChange` applies the new value optimistically and
  // reverts it on a checked `err`.
  //
  // Card 95: the ROLLBACK is unchanged and is still what these two tests pin
  // down — a policy the store did not accept must never be left showing,
  // because this radio is the user's only picture of a security-relevant
  // setting. What changed is what happens NEXT: the `throw err;` that used to
  // follow the rollback (and reach nothing but the console, since
  // `onValueChange` neither awaits nor catches) is now an alert in the
  // section, asserted by the third test below.

  it("reverts the page policy to the previous selection when the write fails", async () => {
    services.settings.setApprovalPolicy = vi.fn(async () =>
      fail(storageFailure("Unavailable", "write failed")),
    );

    const user = userEvent.setup();
    render(SettingsSection);
    await waitFor(() => expect(pageRadio("default")).toHaveAttribute("aria-checked", "true"));

    await user.click(pageRadio("auto-run-all"));

    // Reverts back to "default" once the failed write settles.
    await waitFor(() => expect(pageRadio("default")).toHaveAttribute("aria-checked", "true"));
    expect(pageRadio("auto-run-all")).toHaveAttribute("aria-checked", "false");
  });

  // Card 95: the snap-back above is silent on its own — this is the half that
  // tells the user their click did not take. Queried by TEXT rather than by
  // `role="alert"`: shadcn's `Alert.Root` sets that role on every variant,
  // including the standing safety-annotations notice this section already
  // renders.
  it("says why the page policy write failed, in the section itself", async () => {
    services.settings.setApprovalPolicy = vi.fn(async () =>
      fail(storageFailure("Unavailable", "write failed")),
    );

    const user = userEvent.setup();
    render(SettingsSection);
    await waitFor(() => expect(pageRadio("default")).toHaveAttribute("aria-checked", "true"));

    await user.click(pageRadio("auto-run-all"));

    expect(
      await screen.findByText(new RegExp(m.settingsSection_savePolicyFailedWhat())),
    ).toBeInTheDocument();
  });

  // decisions/20 again: a failed MCP write must not put its message anywhere
  // the page-policy section would show it, and vice versa.
  it("says why the MCP policy write failed, without touching the page section", async () => {
    services.settings.setMcpApprovalPolicy = vi.fn(async () =>
      fail(storageFailure("Unavailable", "write failed")),
    );

    const user = userEvent.setup();
    render(SettingsSection);
    await waitFor(() => expect(mcpRadio("always-confirm")).toHaveAttribute("aria-checked", "true"));

    await user.click(mcpRadio("trust-read-only"));

    expect(
      await screen.findByText(new RegExp(m.settingsSection_saveMcpPolicyFailedWhat())),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(new RegExp(m.settingsSection_savePolicyFailedWhat())),
    ).not.toBeInTheDocument();
  });

  // Card 95: a policy that could not be READ leaves the group showing the
  // documented default, which looks exactly like a deliberate setting — so
  // the section has to say that it is a fallback, not the stored value.
  it("says when the stored policy could not be read at all", async () => {
    services.settings.getApprovalPolicy = vi.fn(async () =>
      fail(storageFailure("Unavailable", "read failed")),
    );

    render(SettingsSection);

    expect(
      await screen.findByText(new RegExp(m.settingsSection_readPolicyFailedWhat())),
    ).toBeInTheDocument();
    expect(pageRadio("default")).toHaveAttribute("aria-checked", "true");
  });

  it("reverts the MCP policy to the previous selection when the write fails", async () => {
    services.settings.setMcpApprovalPolicy = vi.fn(async () =>
      fail(storageFailure("Unavailable", "write failed")),
    );

    const user = userEvent.setup();
    render(SettingsSection);
    await waitFor(() => expect(mcpRadio("always-confirm")).toHaveAttribute("aria-checked", "true"));

    await user.click(mcpRadio("trust-read-only"));

    // Reverts back to "always-confirm" once the failed write settles.
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

    expect(screen.getAllByText(m.settingsSection_riskBadge())).toHaveLength(2);
  });
});

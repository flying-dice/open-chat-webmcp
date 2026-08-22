// Component tests for ApprovalCard.svelte (card 84 checklist: "focus on
// mount, keyboard operation (Tab order, Enter/Escape), approve/deny/
// skip-for-session callbacks, annotation badges render").
//
// Note on "Enter/Escape": ApprovalCard.svelte has no Escape handling at all
// (confirmed by reading the source before writing this file) — there is no
// keydown listener on the card, and neither Deny nor Approve is a form's
// default submit target that Enter could implicitly trigger beyond the
// normal button-activates-on-Enter browser behaviour, which is native
// <button> behaviour, not something this component implements. So this file
// covers Tab order (Deny -> Approve) and leaves Escape/Enter-as-shortcut
// untested rather than asserting behaviour the component doesn't have.
//
// ApprovalCard.svelte imports `{ approve, deny }` from
// ../stores/approvals.svelte (a module-singleton store) — mocked directly
// here for the same reason Composer.test.ts mocks ../stores/selection.svelte:
// exercising the real store would mean also driving its skip-list/policy
// machinery, which belongs to that store's own tests. `AnnotationBadges`,
// the one real child component this renders, is NOT mocked — the "annotation
// badges render" checklist item needs its real output.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import type { ToolCall } from "../../domain/providers";
import type { MergedTool } from "../../domain/tools";
import type { PendingApproval } from "../stores/approvals.svelte";

vi.mock("../stores/approvals.svelte", () => ({
  approve: vi.fn(),
  deny: vi.fn(),
}));

import ApprovalCard from "./ApprovalCard.svelte";
import { approve, deny } from "../stores/approvals.svelte";

function makeCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return { id: "call-1", name: "get_page_text", arguments: { selector: "main" }, ...overrides };
}

function makePageTool(overrides: Partial<MergedTool> = {}): MergedTool {
  return {
    name: "get_page_text",
    description: "Reads the visible text of the current page.",
    annotations: {},
    origin: { kind: "page" },
    call: vi.fn(),
    ...overrides,
  };
}

function makeServerTool(overrides: Partial<MergedTool> = {}): MergedTool {
  return {
    name: "acme__do_thing",
    description: "Does a thing on the Acme server.",
    annotations: { untrustedContentHint: true },
    origin: { kind: "server", serverId: "acme", serverName: "Acme" },
    call: vi.fn(),
    ...overrides,
  };
}

function makePending(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: "req-1",
    call: makeCall(),
    tool: makePageTool(),
    skip: { kind: "page", key: "https://example.com::get_page_text" },
    ...overrides,
  };
}

describe("ApprovalCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // See Composer.test.ts's identical afterEach for why this is explicit
  // rather than relying on @testing-library/svelte's auto-cleanup.
  afterEach(() => {
    cleanup();
  });

  it("focuses the Deny button immediately on mount", () => {
    render(ApprovalCard, { request: makePending() });
    expect(screen.getByRole("button", { name: "Deny" })).toHaveFocus();
  });

  it("moves focus from Deny to Approve on Tab", async () => {
    const user = userEvent.setup();
    render(ApprovalCard, { request: makePending() });

    expect(screen.getByRole("button", { name: "Deny" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Approve" })).toHaveFocus();
  });

  describe("approve/deny/skip-for-session callbacks", () => {
    it("calls deny(request.id) exactly once when Deny is clicked", async () => {
      const user = userEvent.setup();
      const request = makePending({ id: "req-deny" });
      render(ApprovalCard, { request });

      await user.click(screen.getByRole("button", { name: "Deny" }));

      expect(deny).toHaveBeenCalledTimes(1);
      expect(deny).toHaveBeenCalledWith("req-deny");
      expect(approve).not.toHaveBeenCalled();
    });

    it("calls approve(request.id, false) when Approve is clicked with the checkbox unchecked", async () => {
      const user = userEvent.setup();
      const request = makePending({ id: "req-approve" });
      render(ApprovalCard, { request });

      await user.click(screen.getByRole("button", { name: "Approve" }));

      expect(approve).toHaveBeenCalledTimes(1);
      expect(approve).toHaveBeenCalledWith("req-approve", false);
    });

    it("calls approve(request.id, true) when the remember checkbox is checked first", async () => {
      const user = userEvent.setup();
      const request = makePending({
        id: "req-remember",
        tool: makePageTool(),
      });
      render(ApprovalCard, { request });

      await user.click(
        screen.getByRole("checkbox", { name: "Don't ask again for this tool on this page (this session)" }),
      );
      await user.click(screen.getByRole("button", { name: "Approve" }));

      expect(approve).toHaveBeenCalledTimes(1);
      expect(approve).toHaveBeenCalledWith("req-remember", true);
    });

    it("labels the checkbox for a page-origin tool as 'on this page (this session)'", () => {
      const request = makePending({ tool: makePageTool() });
      render(ApprovalCard, { request });

      expect(
        screen.getByRole("checkbox", { name: "Don't ask again for this tool on this page (this session)" }),
      ).toBeInTheDocument();
    });

    it("labels the checkbox for a server-origin tool as 'on this server (this session)'", () => {
      const request = makePending({
        tool: makeServerTool(),
        skip: { kind: "server", key: "acme::acme__do_thing" },
      });
      render(ApprovalCard, { request });

      expect(
        screen.getByRole("checkbox", { name: "Don't ask again for this tool on this server (this session)" }),
      ).toBeInTheDocument();
    });

    it("shows the 'Origin unknown' copy when the request's tool is undefined", () => {
      const request = makePending({ tool: undefined, call: makeCall({ name: "vanished_tool" }) });
      render(ApprovalCard, { request });

      expect(
        screen.getByText("Origin unknown — this name isn't in the current tool list."),
      ).toBeInTheDocument();
    });
  });

  describe("annotation badges", () => {
    it("shows 'read-only' when the tool's annotations set readOnlyHint", () => {
      const request = makePending({
        tool: makePageTool({ annotations: { readOnlyHint: true } }),
      });
      render(ApprovalCard, { request });

      expect(screen.getByText("read-only")).toBeInTheDocument();
    });

    it("shows 'untrusted content' when the tool's annotations set untrustedContentHint", () => {
      const request = makePending({
        tool: makePageTool({ annotations: { untrustedContentHint: true } }),
      });
      render(ApprovalCard, { request });

      expect(screen.getByText("untrusted content")).toBeInTheDocument();
    });

    it("shows 'unannotated' when the tool has no annotations at all", () => {
      const request = makePending({
        tool: makePageTool({ annotations: {} }),
      });
      render(ApprovalCard, { request });

      expect(screen.getByText("unannotated")).toBeInTheDocument();
    });

    it("shows 'server: destructive' for a server tool whose mcpAnnotations set destructiveHint", () => {
      const request = makePending({
        tool: makeServerTool({ mcpAnnotations: { destructiveHint: true } }),
        skip: { kind: "server", key: "acme::acme__do_thing" },
      });
      render(ApprovalCard, { request });

      expect(screen.getByText("server: destructive")).toBeInTheDocument();
    });
  });
});

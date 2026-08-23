// Component tests for ContextChip.svelte — decisions/40's SHARING GATE as a
// control (card 119).
//
// The chip is pure props: App.svelte reads
// src/sidepanel/stores/pageSharing.svelte.ts and hands the answers down, so
// nothing here needs a store mock and every state is reachable by rendering.
// The gate's own RULES (what a dismissal is scoped to, what it stops being
// pulled) are the store's, and are pinned in
// ../stores/pageSharing.svelte.test.ts; this file is about what a user can
// see and press.
//
// No `vi.resetModules()`, per the standing note in this folder's other test
// files: it corrupts Svelte's internal module state for any bits-ui
// component mounted afterwards.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import "../../ui/testing/resize-observer";
import ContextChip from "./ContextChip.svelte";
import type { PageInfo } from "../stores/panel.svelte";
import { m } from "../../paraglide/messages.js";

function pageInfo(overrides: Partial<PageInfo> = {}): PageInfo {
  return {
    tabId: 1,
    title: "Example Domain",
    origin: "https://example.com",
    toolCount: 3,
    restricted: false,
    webmcpAvailable: true,
    ...overrides,
  };
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    pageInfo: pageInfo(),
    connectionStatus: "connected" as const,
    onOpenTools: vi.fn(),
    sharing: true,
    shareContent: false,
    onSetSharing: vi.fn(),
    onSetShareContent: vi.fn(),
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("ContextChip", () => {
  describe("sharing (the default)", () => {
    it("says which page it is sharing and how many tools it publishes", () => {
      render(ContextChip, { props: baseProps() });

      expect(
        screen.getByText(m.contextChip_sharing({ title: "Example Domain" })),
      ).toBeInTheDocument();
      expect(screen.getByText(m.contextChip_toolCount({ count: 3 }))).toBeInTheDocument();
    });

    it("opens the tools view when the strip is pressed", async () => {
      const onOpenTools = vi.fn();
      render(ContextChip, { props: baseProps({ onOpenTools }) });

      await fireEvent.click(screen.getByRole("button", { name: /Example Domain/ }));

      expect(onOpenTools).toHaveBeenCalledTimes(1);
    });

    it("offers a dismiss with a real accessible name, which asks for sharing to stop", async () => {
      const onSetSharing = vi.fn();
      render(ContextChip, { props: baseProps({ onSetSharing }) });

      await fireEvent.click(screen.getByRole("button", { name: m.contextChip_stopSharingLabel() }));

      expect(onSetSharing).toHaveBeenCalledWith(false);
    });

    it("shows NO page-content control in the default sharing row — the toggle lives in the kebab menu now (Jonathan, 2026-08-23)", () => {
      render(ContextChip, { props: baseProps({}) });

      expect(
        screen.queryByRole("button", { name: m.contextChip_shareContentLabel() }),
      ).not.toBeInTheDocument();
    });

    it("shows the page-content toggle as pressed when it is on, and turns it back off", async () => {
      const onSetShareContent = vi.fn();
      render(ContextChip, { props: baseProps({ shareContent: true, onSetShareContent }) });

      const toggle = screen.getByRole("button", { name: m.contextChip_shareContentLabel() });
      expect(toggle).toHaveAttribute("aria-pressed", "true");

      await fireEvent.click(toggle);
      expect(onSetShareContent).toHaveBeenCalledWith(false);
    });
  });

  describe("not sharing", () => {
    it("says so, and says nothing at all about the page's tools", () => {
      render(ContextChip, { props: baseProps({ sharing: false }) });

      expect(screen.getByText(m.contextChip_notSharing())).toBeInTheDocument();
      expect(screen.queryByText(m.contextChip_toolCount({ count: 3 }))).toBeNull();
      expect(screen.queryByText(m.contextChip_sharing({ title: "Example Domain" }))).toBeNull();
    });

    it("offers an equally visible, LABELLED way back", async () => {
      const onSetSharing = vi.fn();
      render(ContextChip, { props: baseProps({ sharing: false, onSetSharing }) });

      await fireEvent.click(screen.getByRole("button", { name: m.contextChip_shareAgainLabel() }));

      expect(onSetSharing).toHaveBeenCalledWith(true);
    });

    it("stops being a doorway to the tool inspector", () => {
      render(ContextChip, { props: baseProps({ sharing: false }) });

      expect(screen.queryByRole("button", { name: /Example Domain/ })).toBeNull();
    });

    it("withdraws the page-content toggle and the dismiss", () => {
      render(ContextChip, { props: baseProps({ sharing: false }) });

      expect(screen.queryByRole("button", { name: m.contextChip_shareContentLabel() })).toBeNull();
      expect(screen.queryByRole("button", { name: m.contextChip_stopSharingLabel() })).toBeNull();
    });
  });

  describe("a restricted page behaves exactly as it did (decisions/40)", () => {
    it("says Chrome cannot be run here and offers no gate at all", () => {
      render(ContextChip, {
        props: baseProps({ pageInfo: pageInfo({ restricted: true, toolCount: 0 }) }),
      });

      expect(screen.getByText(/example\.com/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: m.contextChip_stopSharingLabel() })).toBeNull();
      expect(screen.queryByRole("button", { name: m.contextChip_shareContentLabel() })).toBeNull();
      expect(screen.queryByRole("button", { name: m.contextChip_shareAgainLabel() })).toBeNull();
    });

    it("keeps offering no gate even if the store somehow reported the page as not shared", () => {
      render(ContextChip, {
        props: baseProps({ pageInfo: pageInfo({ restricted: true }), sharing: false }),
      });

      expect(screen.queryByText(m.contextChip_notSharing())).toBeNull();
      expect(screen.queryByRole("button", { name: m.contextChip_shareAgainLabel() })).toBeNull();
    });
  });

  it("offers no gate before a tab has resolved", () => {
    render(ContextChip, { props: baseProps({ pageInfo: undefined }) });

    expect(screen.getByText(m.contextChip_noActiveTab())).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: m.contextChip_stopSharingLabel() })).toBeNull();
  });
});

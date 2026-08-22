// Component tests for ToolsPanel.svelte's page section — specifically card
// 119's requirement that a dismissed sharing gate HIDES this page's tools
// (decisions/40) rather than quietly reporting that there are none.
//
// The four other empty states (restricted / WebMCP off / nothing published /
// no server tools) are exercised here only where the gate has to be ordered
// against them; the section's own copy predates this card.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import "../../ui/testing/resize-observer";
import ToolsPanel from "./ToolsPanel.svelte";
import type { SerializedTool } from "../../domain/tools";
import { m } from "../../paraglide/messages.js";

const tools: SerializedTool[] = [
  { name: "book_flight", description: "Book a flight", inputSchema: { type: "object" } },
];

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    tools,
    serverTools: [],
    webmcpAvailable: true,
    restricted: false,
    sharing: true,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("ToolsPanel and the sharing gate", () => {
  it("lists the page's tools while sharing", () => {
    render(ToolsPanel, { props: baseProps() });

    expect(screen.getByText("book_flight")).toBeInTheDocument();
  });

  it("hides them, and says why, once sharing is dismissed", () => {
    render(ToolsPanel, { props: baseProps({ sharing: false }) });

    expect(screen.queryByText("book_flight")).toBeNull();
    expect(screen.getByText(m.toolsPanel_notSharingTitle())).toBeInTheDocument();
    expect(screen.getByText(m.toolsPanel_notSharingDescription())).toBeInTheDocument();
  });

  it("never claims the page publishes no tools when it is simply not being looked at", () => {
    render(ToolsPanel, { props: baseProps({ sharing: false }) });

    expect(screen.queryByText(m.toolsPanel_noPageToolsTitle())).toBeNull();
  });

  it("lets Chrome's refusal outrank the user's: a restricted page still reads as restricted", () => {
    render(ToolsPanel, { props: baseProps({ tools: [], restricted: true, sharing: false }) });

    expect(screen.getByText(m.toolsPanel_restrictedTitle())).toBeInTheDocument();
    expect(screen.queryByText(m.toolsPanel_notSharingTitle())).toBeNull();
  });

  it("leaves the MCP server section alone — server tools are not the page's", () => {
    render(ToolsPanel, { props: baseProps({ sharing: false }) });

    expect(screen.getByText(m.toolsPanel_mcpServersHeading())).toBeInTheDocument();
    expect(screen.getByText(m.toolsPanel_noServerToolsTitle())).toBeInTheDocument();
  });
});

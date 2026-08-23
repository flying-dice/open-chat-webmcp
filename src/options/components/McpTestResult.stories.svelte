<script module lang="ts">
  /**
   * Card 125 (decisions/42-storybook.md). Pure props over one `McpTestOutcome`
   * (../forms/mcpTestConnection.ts) — no services. Covers the disclosure's
   * two states (collapsed/expanded) via `play`, plus the error kind card 39
   * calls out by name: "not an MCP endpoint" must read plainly rather than as
   * a generic connection failure.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, within } from "storybook/test";
  import McpTestResult from "./McpTestResult.svelte";
  import type { McpTestOutcome } from "../forms/mcpTestConnection";
  import { m } from "../../paraglide/messages.js";

  const SUCCESS_WITH_TOOLS: McpTestOutcome = {
    kind: "success",
    connection: {
      protocolVersion: "2025-06-18",
      serverInfo: { name: "github-mcp", title: "GitHub", version: "1.4.0" },
    },
    tools: [
      { name: "search_issues", description: "Search issues across a repository" },
      { name: "create_pull_request", description: "Open a new pull request" },
      { name: "get_file_contents" },
    ],
  };

  const SUCCESS_NO_TOOLS: McpTestOutcome = {
    kind: "success",
    connection: { protocolVersion: "2025-06-18" },
    tools: [],
  };

  const NOT_MCP_ENDPOINT: McpTestOutcome = {
    kind: "not-mcp-endpoint",
    message: "The server responded, but not with a valid MCP handshake.",
  };

  const { Story } = defineMeta({
    title: "Options/McpTestResult",
    component: McpTestResult,
    tags: ["autodocs"],
  });
</script>

<Story name="No result yet" args={{ outcome: undefined }} />

<Story name="Success, tools collapsed" args={{ outcome: SUCCESS_WITH_TOOLS }} />

<!-- Drives the real disclosure toggle rather than asserting a synthetic
     "expanded" prop that doesn't exist — `toolsExpanded` is this component's
     own local state. -->
<Story
  name="Success, tools expanded"
  args={{ outcome: SUCCESS_WITH_TOOLS }}
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const showLabel = `${m.showAction()} ${m.mcpTestResult_toolCountLabel({ count: 3 })}`;
    await userEvent.click(canvas.getByRole("button", { name: showLabel }));
    await expect(canvas.getByText("search_issues")).toBeInTheDocument();
  }}
/>

<Story name="Success, zero tools" args={{ outcome: SUCCESS_NO_TOOLS }} />

<Story name="Not an MCP endpoint" args={{ outcome: NOT_MCP_ENDPOINT }} />

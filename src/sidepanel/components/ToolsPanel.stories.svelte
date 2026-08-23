<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). Card 11's Tools view — the FOUR
   * distinct empty states for the "This page" section (restricted, not
   * sharing, WebMCP unavailable, no tools published) plus the separate "no
   * server tools" empty state and a fully populated view.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ToolsPanel from "./ToolsPanel.svelte";
  import type { SerializedTool } from "../../domain/tools";
  import type { MergedTool } from "../../domain/tools";

  const PAGE_TOOLS: SerializedTool[] = [
    {
      name: "read_page_text",
      description: "Reads the visible text of the current page.",
      annotations: { readOnlyHint: true },
    },
  ];

  const SERVER_TOOLS: MergedTool[] = [
    {
      name: "acme__run_query",
      description: "Runs a read-only SQL query against the Acme warehouse.",
      annotations: { untrustedContentHint: true },
      origin: { kind: "server", serverId: "acme", serverName: "Acme" },
      call: async () => ({ ok: true, result: undefined }),
    },
  ];

  const { Story } = defineMeta({
    title: "Side panel/ToolsPanel",
    component: ToolsPanel,
    tags: ["autodocs"],
    parameters: { panelWidth: 400 },
    args: {
      tools: [],
      serverTools: [],
      webmcpAvailable: true,
      restricted: false,
      sharing: true,
    },
  });
</script>

<!-- Empty state 1: Chrome never allowed a content script into this tab at all. -->
<Story name="Restricted page" args={{ restricted: true }} />

<!-- Empty state 2: decisions/40's sharing gate is down. -->
<Story name="Not sharing this page" args={{ sharing: false }} />

<!-- Empty state 3: a content script runs here, but WebMCP itself is off. -->
<Story name="WebMCP unavailable" args={{ webmcpAvailable: false }} />

<!-- Empty state 4: WebMCP works here; this page just hasn't published anything. -->
<Story name="Page publishes no tools" />

<!-- The server-tools section's own empty state, independent of the page's. -->
<Story name="No MCP server tools" args={{ tools: PAGE_TOOLS }} />

<Story name="Populated (page + server tools)" args={{ tools: PAGE_TOOLS, serverTools: SERVER_TOOLS }} />

<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). One tool card in the Tools view
   * (card 11) — name, description, origin and annotation badges, with a
   * collapsed-by-default input schema.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ToolListItem from "./ToolListItem.svelte";
  import type {
    SerializedTool,
    ToolAnnotations,
    McpToolAnnotations,
    ToolOrigin,
  } from "../../domain/tools";

  type Tool = Pick<SerializedTool, "name" | "description" | "inputSchema"> & {
    annotations?: ToolAnnotations | undefined;
    mcpAnnotations?: McpToolAnnotations | undefined;
    origin: ToolOrigin;
  };

  const PAGE_TOOL: Tool = {
    name: "read_page_text",
    description: "Reads the visible text of the current page.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string" } },
      required: ["selector"],
    },
    origin: { kind: "page" },
  };

  const SERVER_TOOL: Tool = {
    name: "acme__run_query",
    description: "Runs a read-only SQL query against the Acme warehouse.",
    annotations: { untrustedContentHint: true },
    mcpAnnotations: { destructiveHint: true, title: "Run a database query" },
    origin: { kind: "server", serverId: "acme", serverName: "Acme" },
  };

  const { Story } = defineMeta({
    title: "Side panel/ToolListItem",
    component: ToolListItem,
    tags: ["autodocs"],
    parameters: { panelWidth: 400 },
    args: { tool: PAGE_TOOL },
  });
</script>

<Story name="Page tool" />

<Story name="Server tool" args={{ tool: SERVER_TOOL }} />

<Story
  name="Unannotated tool, no description"
  args={{ tool: { name: "mystery_tool", annotations: {}, origin: { kind: "page" } } }}
/>

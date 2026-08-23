<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). The Tools / Call Log tabbed view
   * (card 11) — App.svelte's second panel view.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Inspector from "./Inspector.svelte";
  import type { SerializedTool, MergedTool } from "../../domain/tools";
  import type { ToolCallLogEntry } from "../../domain/chat";

  const PAGE_TOOLS: SerializedTool[] = [
    {
      name: "read_page_text",
      description: "Reads the visible text of the current page.",
      annotations: { readOnlyHint: true },
    },
  ];

  const TOOL_CALLS: ToolCallLogEntry[] = [
    {
      id: "call-1",
      name: "read_page_text",
      arguments: { selector: "main" },
      mode: "auto",
      origin: { kind: "page" },
      result: "The page discusses the history of the Byzantine Empire.",
      startedAt: Date.now() - 8000,
      endedAt: Date.now() - 7500,
    },
  ];

  const { Story } = defineMeta({
    title: "Side panel/Inspector",
    component: Inspector,
    tags: ["autodocs"],
    parameters: { panelWidth: 400 },
    args: {
      tools: PAGE_TOOLS,
      serverTools: [] as MergedTool[],
      toolCalls: TOOL_CALLS,
      webmcpAvailable: true,
      restricted: false,
      sharing: true,
    },
  });
</script>

<Story name="Tools tab (default)" />

<Story name="Empty page, restricted" args={{ tools: [], toolCalls: [], restricted: true }} />

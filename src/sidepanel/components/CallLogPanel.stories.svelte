<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). Every tool call this session,
   * newest first.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import CallLogPanel from "./CallLogPanel.svelte";
  import type { ToolCallLogEntry } from "../../domain/chat";

  const NOW = Date.UTC(2026, 7, 23, 9, 0, 0);

  const ENTRIES: ToolCallLogEntry[] = [
    {
      id: "call-1",
      name: "read_page_text",
      arguments: { selector: "main" },
      mode: "auto",
      origin: { kind: "page" },
      result: "The page discusses the history of the Byzantine Empire.",
      startedAt: NOW - 8000,
      endedAt: NOW - 7500,
    },
    {
      id: "call-2",
      name: "delete_all_items",
      arguments: { confirm: true },
      mode: "denied",
      origin: { kind: "page" },
      errorNote: { kind: "tool-denied" },
      startedAt: NOW - 4000,
      endedAt: NOW - 4000,
    },
  ];

  const { Story } = defineMeta({
    title: "Side panel/CallLogPanel",
    component: CallLogPanel,
    tags: ["autodocs"],
    parameters: { panelWidth: 400 },
    args: { toolCalls: ENTRIES },
  });
</script>

<Story name="With entries (newest first)" />

<Story name="Empty" args={{ toolCalls: [] }} />

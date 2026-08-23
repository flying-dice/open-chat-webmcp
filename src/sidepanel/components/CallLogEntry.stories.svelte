<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). One entry in the Call Log — the
   * accountability surface (decisions/05). Auto-run successes start
   * collapsed; anything a human decided on, or that failed, starts expanded.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import CallLogEntry from "./CallLogEntry.svelte";
  import type { ToolCallLogEntry } from "../../domain/chat";

  const NOW = Date.UTC(2026, 7, 23, 9, 0, 0);

  const SUCCESS: ToolCallLogEntry = {
    id: "call-1",
    name: "read_page_text",
    arguments: { selector: "main" },
    mode: "auto",
    origin: { kind: "page" },
    result: "The page discusses the history of the Byzantine Empire.",
    startedAt: NOW - 4000,
    endedAt: NOW - 3000,
  };

  const DENIED: ToolCallLogEntry = {
    id: "call-2",
    name: "delete_all_items",
    arguments: { confirm: true },
    mode: "denied",
    origin: { kind: "page" },
    errorNote: { kind: "tool-denied" },
    startedAt: NOW - 2000,
    endedAt: NOW - 2000,
  };

  const SERVER_ERROR: ToolCallLogEntry = {
    id: "call-3",
    name: "acme__run_query",
    arguments: { query: "SELECT * FROM orders" },
    mode: "approved",
    origin: { kind: "server", serverId: "acme", serverName: "Acme" },
    error: "connection to Acme MCP server timed out",
    startedAt: NOW - 6000,
    endedAt: NOW - 1000,
  };

  const STILL_RUNNING: ToolCallLogEntry = {
    id: "call-4",
    name: "click_button",
    arguments: { selector: "#submit" },
    mode: "auto",
    origin: { kind: "page" },
    startedAt: NOW - 500,
  };

  const { Story } = defineMeta({
    title: "Side panel/CallLogEntry",
    component: CallLogEntry,
    tags: ["autodocs"],
    args: { entry: SUCCESS },
  });
</script>

<Story name="Auto-run success (collapsed)" />

<Story name="Denied" args={{ entry: DENIED }} />

<Story name="Server tool error" args={{ entry: SERVER_ERROR }} />

<Story name="Still running" args={{ entry: STILL_RUNNING }} />

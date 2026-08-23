<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). One row in the History view (card
   * 34) — active/clamped-long/deleting, per this card's brief.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import HistoryListItem from "./HistoryListItem.svelte";
  import type { ChatSummary } from "../../domain/chat";

  const NOW = Date.UTC(2026, 7, 23, 9, 0, 0);
  const HOUR = 60 * 60 * 1000;

  const SUMMARY: ChatSummary = {
    id: "chat-1",
    origin: "https://en.wikipedia.org",
    createdAt: NOW - HOUR,
    updatedAt: NOW - 5 * 60 * 1000,
    messageCount: 12,
    toolCallCount: 3,
    preview: "Summarise this article and pull out the dates",
    title: "Byzantine timeline",
  };

  /** card 116's journal: a long title + long origin, clamped to one line by `line-clamp-1`. */
  const LONG_SUMMARY: ChatSummary = {
    id: "chat-2",
    origin: "https://www.an-unusually-long-subdomain-name.example.com",
    createdAt: NOW - 2 * HOUR,
    updatedAt: NOW - HOUR,
    messageCount: 48,
    toolCallCount: 11,
    title:
      "A conversation with a genuinely very long, descriptive title that keeps going and going",
  };

  const { Story } = defineMeta({
    title: "Side panel/HistoryListItem",
    component: HistoryListItem,
    tags: ["autodocs"],
    parameters: { panelWidth: 400 },
    args: {
      summary: SUMMARY,
      active: false,
      opening: false,
      deleting: false,
      onOpen: () => undefined,
      onDelete: () => undefined,
    },
  });
</script>

<Story name="Ordinary" />

<Story name="Active (current chat)" args={{ active: true }} />

<Story name="Long title and origin (clamped)" args={{ summary: LONG_SUMMARY }} />

<Story name="Deleting" args={{ deleting: true }} />

<Story name="At 320px" parameters={{ panelWidth: 320 }} args={{ summary: LONG_SUMMARY }} />

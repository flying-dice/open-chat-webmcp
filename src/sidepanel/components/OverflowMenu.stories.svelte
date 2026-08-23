<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). The header's kebab menu —
   * recent chats (read through `sidePanelServices().chats.listChatSummaries`,
   * seeded exactly like HistoryPanel.stories.svelte), plus the active-chat
   * export row, which needs `panel.messages` to be non-empty to enable.
   *
   * `panel.messages`/`activeChatId` come from `panel.svelte.ts`'s `session`
   * state, which nothing but `presenter.show(...)` ever assigns — the SAME
   * real production entrypoint `ChatService` calls when a chat loads. Calling
   * it here from the seed hook is seeding the store through its own real
   * write path with fake data, not a story-only mock (see
   * .storybook/story-services.ts's header for the same posture on services).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import OverflowMenu from "./OverflowMenu.svelte";
  import type { ChatSummary } from "../../domain/chat";
  import { ok } from "../../domain/result";
  import type { SidePanelServices } from "../app-services";
  import { presenter } from "../stores/panel.svelte";

  const NOW = Date.UTC(2026, 7, 23, 9, 0, 0);

  const SUMMARIES: ChatSummary[] = [
    {
      id: "chat-wikipedia",
      origin: "https://en.wikipedia.org",
      createdAt: NOW - 3600_000,
      updatedAt: NOW - 300_000,
      messageCount: 12,
      toolCallCount: 3,
      title: "Byzantine timeline",
    },
    {
      id: "chat-github",
      origin: "https://github.com",
      createdAt: NOW - 6 * 3600_000,
      updatedAt: NOW - 5 * 3600_000,
      messageCount: 4,
      toolCallCount: 0,
      preview: "What changed in this pull request?",
    },
  ];

  const seedRecentChats = (services: SidePanelServices): void => {
    services.chats.listChatSummaries = async () => ok(SUMMARIES);
    presenter.show({
      id: "chat-wikipedia",
      origin: "https://en.wikipedia.org",
      messages: [
        { id: "u1", role: "user", content: "Summarise this article", createdAt: NOW - 300_000 },
        {
          id: "a1",
          role: "assistant",
          content: "It covers the Byzantine timeline.",
          createdAt: NOW - 290_000,
        },
      ],
      toolCalls: [],
      createdAt: NOW - 3600_000,
      updatedAt: NOW - 290_000,
    });
  };

  const { Story } = defineMeta({
    title: "Side panel/OverflowMenu",
    component: OverflowMenu,
    tags: ["autodocs"],
    parameters: { panelWidth: 400, services: { sidepanel: seedRecentChats } },
    args: {
      onOpenHistory: () => undefined,
      onOpenTools: () => undefined,
      onOpenChat: () => undefined,
      connectionStatus: "connected",
    },
  });
</script>

<!-- The trigger renders closed; open it from the canvas toolbar to see the seeded recent-chats list and the enabled Export row (panel.messages is non-empty above). -->
<Story name="With recent chats" />

<Story name="Disconnected" args={{ connectionStatus: "disconnected" }} />

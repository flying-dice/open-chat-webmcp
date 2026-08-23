<script module lang="ts">
  /**
   * Proof story 1 of card 123 (decisions/42-storybook.md): a SIDE-PANEL
   * component that reads a domain port.
   *
   * HistoryPanel calls `sidePanelServices().chats.listChatSummaries()` from an
   * `$effect` on mount, so it is the component that proves the whole services
   * seam works in Storybook — the fakes are the SAME ones HistoryPanel.test.ts
   * drives (../testing/fake-services.ts), reached through the per-story
   * `services.sidepanel` seed that .storybook/preview.ts's `withServices`
   * decorator applies to a freshly reset bundle. No story-only mock exists
   * anywhere in this file.
   *
   * `parameters.panelWidth` puts it in a 400px box, which is the point of that
   * axis: this list's title/origin/preview stack is exactly the thing that
   * breaks at 320px, and both widths are one toolbar click apart.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import HistoryPanel from "./HistoryPanel.svelte";
  import type { ChatSummary } from "../../domain/chat";
  import { fail, ok } from "../../domain/result";
  import type { SidePanelServices } from "../app-services";
  import { storageFailure } from "../testing/fake-services";

  const HOUR = 60 * 60 * 1000;
  const NOW = Date.UTC(2026, 7, 23, 9, 0, 0);

  /** Three chats across three origins, newest first — what the store hands back. */
  const SUMMARIES: ChatSummary[] = [
    {
      id: "chat-wikipedia",
      origin: "https://en.wikipedia.org",
      createdAt: NOW - HOUR,
      updatedAt: NOW - 5 * 60 * 1000,
      messageCount: 12,
      toolCallCount: 3,
      preview: "Summarise this article and pull out the dates",
      title: "Byzantine timeline",
    },
    {
      id: "chat-github",
      origin: "https://github.com",
      createdAt: NOW - 6 * HOUR,
      updatedAt: NOW - 5 * HOUR,
      messageCount: 4,
      toolCallCount: 0,
      preview: "What changed in this pull request?",
    },
    {
      id: "chat-localhost",
      origin: "http://localhost:5173",
      createdAt: NOW - 30 * HOUR,
      updatedAt: NOW - 29 * HOUR,
      messageCount: 2,
      toolCallCount: 7,
      preview: "Fill the signup form with the test fixture and submit it",
    },
  ];

  /**
   * The two canned outcomes, named once and reused across the four stories
   * below. Typed against `SidePanelServices` rather than left to inference:
   * Storybook types `parameters` as an open `Record<string, any>` bag, so an
   * inline callback there gets no contextual type at all and `npm run check`
   * (maximal strictness, `noImplicitAny`) fails on it.
   */
  const seedSummaries = (services: SidePanelServices): void => {
    services.chats.listChatSummaries = async () => ok(SUMMARIES);
  };

  const seedStorageFailure = (services: SidePanelServices): void => {
    services.chats.listChatSummaries = async () => fail(storageFailure());
  };

  const { Story } = defineMeta({
    title: "Side panel/HistoryPanel",
    component: HistoryPanel,
    tags: ["autodocs"],
    parameters: { panelWidth: 400 },
    args: { onOpenChat: () => undefined },
  });
</script>

<Story
  name="Seeded"
  parameters={{ services: { sidepanel: seedSummaries } }}
/>

<!-- The ordinary state of a fresh install — the Empty primitive, not a blank box. -->
<Story name="No chats yet" />

<!--
  Card 92/95's absorbed-failure path: the store could not be read, so the view
  shows its own error line rather than the panel's notice channel.
-->
<Story
  name="Storage unavailable"
  parameters={{ services: { sidepanel: seedStorageFailure } }}
/>

<!-- Narrowest width Chrome allows a side panel, with the seeded list in it. -->
<Story
  name="Seeded at 320px"
  parameters={{ panelWidth: 320, services: { sidepanel: seedSummaries } }}
/>

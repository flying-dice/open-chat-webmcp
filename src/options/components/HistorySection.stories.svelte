<script module lang="ts">
  /**
   * Card 125 (decisions/42-storybook.md). HistorySection reads
   * `optionsServices().chats` from an `onMount` effect, so every story seeds
   * `parameters.services.options`. The "Clear all history" confirmation is a
   * bits-ui `AlertDialog` — a genuine PORTAL-bearing component, unlike the
   * Select popovers elsewhere on this page — so the "Clear all confirmation"
   * story below is this card's dialog portal check: its `play` function
   * clicks the trigger and asserts the dialog's title/description text is
   * found via the canvas element's OWN document (the iframe Storybook mounts
   * the story into), confirming bits-ui's `AlertDialog.Content` portals into
   * that same iframe document rather than escaping it — no workaround
   * needed, same as the McpServerForm Select story's finding.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import HistorySection from "./HistorySection.svelte";
  import type { ChatSummary } from "../../domain/chat";
  import { fail, ok } from "../../domain/result";
  import type { OptionsServices } from "../app-services";
  import { storageFailure } from "../testing/fake-services";
  import { m } from "../../paraglide/messages.js";

  const HOUR = 60 * 60 * 1000;
  const NOW = Date.UTC(2026, 7, 23, 9, 0, 0);

  const SUMMARIES: ChatSummary[] = [
    {
      id: "chat-wikipedia",
      origin: "https://en.wikipedia.org",
      createdAt: NOW - HOUR,
      updatedAt: NOW - 5 * 60 * 1000,
      messageCount: 12,
      toolCallCount: 3,
      preview: "Summarise this article and pull out the dates",
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
  ];

  const seedSummaries = (services: OptionsServices): void => {
    services.chats.listChatSummaries = async () => ok(SUMMARIES);
  };

  const seedStorageFailure = (services: OptionsServices): void => {
    services.chats.listChatSummaries = async () => fail(storageFailure());
  };

  const { Story } = defineMeta({
    title: "Options/HistorySection",
    component: HistorySection,
    tags: ["autodocs"],
  });
</script>

<Story name="Seeded" parameters={{ services: { options: seedSummaries } }} />

<!-- The ordinary state of a fresh install — the Empty primitive, not a blank box. -->
<Story name="No chats yet" />

<Story name="Storage unavailable" parameters={{ services: { options: seedStorageFailure } }} />

<Story
  name="Clear-all confirmation open"
  parameters={{ services: { options: seedSummaries } }}
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: m.historyClearAllButton({ count: SUMMARIES.length }) }),
      ).toBeInTheDocument(),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: m.historyClearAllButton({ count: SUMMARIES.length }) }),
    );
    // The AlertDialog is a bits-ui portal — asserting through canvasElement's
    // own document (rather than assuming it stayed inside canvasElement's
    // subtree) is what proves it rendered in THIS iframe.
    const doc = within(canvasElement.ownerDocument.body);
    await expect(
      await doc.findByText(m.historyClearConfirmTitle({ count: SUMMARIES.length })),
    ).toBeInTheDocument();
  }}
/>

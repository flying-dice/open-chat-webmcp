<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). The timeline for one activity
   * group (card 61) — a summary trigger plus a rail of ToolCallRows.
   * Expansion default (decisions/26): live -> expanded; an error/denied step
   * anywhere in the group -> stays expanded regardless of `live`.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ActivityGroup from "./ActivityGroup.svelte";
  import type { TranscriptEntry } from "../../domain/chat";

  function toolStep(id: string, overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
    return {
      id,
      role: "tool",
      content: "done",
      createdAt: 0,
      toolName: "read_page_text",
      toolCallId: id,
      toolArgs: { selector: "main" },
      toolStatus: "success",
      toolMode: "auto",
      toolOrigin: { kind: "page" },
      ...overrides,
    };
  }

  const DONE_STEPS: TranscriptEntry[] = [
    toolStep("t1", { toolName: "read_page_text" }),
    toolStep("t2", { toolName: "click_button", content: "" }),
  ];

  const FAILED_STEPS: TranscriptEntry[] = [
    toolStep("t3", { toolName: "read_page_text" }),
    toolStep("t4", {
      toolName: "submit_form",
      toolStatus: "error",
      toolMode: "approved",
      content: "the server rejected the submission",
    }),
  ];

  const { Story } = defineMeta({
    title: "Side panel/ActivityGroup",
    component: ActivityGroup,
    tags: ["autodocs"],
    parameters: { panelWidth: 400 },
    args: { steps: DONE_STEPS, live: false },
  });
</script>

<Story name="Done (collapsed by default)" />

<Story name="Live (auto-expanded)" args={{ steps: DONE_STEPS, live: true }} />

<Story
  name="Contains a failed step (stays expanded)"
  args={{ steps: FAILED_STEPS, live: false }}
/>

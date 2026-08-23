<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). The row of actions under a
   * finished assistant reply — copy is always present, Regenerate only for
   * the last reply (decisions/18).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import MessageActions from "./MessageActions.svelte";

  const { Story } = defineMeta({
    title: "Side panel/MessageActions",
    component: MessageActions,
    tags: ["autodocs"],
    args: { content: "Here is the answer to your question." },
  });
</script>

<Story name="Copy only" />

<Story name="Copy + Regenerate (last reply)" args={{ onRegenerate: () => undefined }} />

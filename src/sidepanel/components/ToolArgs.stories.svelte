<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). Top-level "arguments" display,
   * shared by ApprovalCard.svelte (before a call runs) and CallLogEntry's
   * expanded view (after).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ToolArgs from "./ToolArgs.svelte";

  const { Story } = defineMeta({
    title: "Side panel/ToolArgs",
    component: ToolArgs,
    tags: ["autodocs"],
    args: { args: { selector: "main", includeHidden: false } },
  });
</script>

<Story name="A few arguments" />

<Story name="No arguments" args={{ args: {} }} />

<Story name="Undefined args" args={{ args: undefined }} />

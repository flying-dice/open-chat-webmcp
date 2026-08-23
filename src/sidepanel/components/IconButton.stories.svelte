<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). The round icon button — every
   * variant this repo actually uses: the plain toolbar glyph, the filled
   * primary send button, the filled danger stop button, and the compact
   * inline size used in the per-reply copy/regenerate row.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import IconButton from "./IconButton.svelte";

  const { Story } = defineMeta({
    title: "Side panel/IconButton",
    component: IconButton,
    tags: ["autodocs"],
    args: { icon: "settings", label: "Settings" },
  });
</script>

<Story name="Plain (toolbar default)" />

<Story
  name="Filled primary (send)"
  args={{ icon: "arrow_upward", label: "Send message", variant: "filled", tone: "primary" }}
/>

<Story
  name="Filled danger (stop)"
  args={{ icon: "stop", label: "Stop generating", variant: "filled", tone: "danger" }}
/>

<Story
  name="Compact (inline row)"
  args={{ icon: "content_copy", label: "Copy response", size: "compact" }}
/>

<Story name="Disabled" args={{ disabled: true }} />

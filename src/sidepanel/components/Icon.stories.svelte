<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). A single glyph — no services, no
   * stores, purely a `name` prop over the Hugeicons map (see Icon.svelte's
   * own header for the two custom paths that aren't stock Hugeicons).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Icon from "./Icon.svelte";

  const { Story } = defineMeta({
    title: "Side panel/Icon",
    component: Icon,
    tags: ["autodocs"],
    args: { name: "sparkle" },
  });
</script>

<Story name="Custom glyph (sparkle)" />

<Story name="Standard glyph (build)" args={{ name: "build" }} />

<Story name="Mark size" args={{ name: "smart_toy", class: "size-5" }} />

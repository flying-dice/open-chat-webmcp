<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). The generic hover/focus tooltip —
   * see Tooltip.svelte's own header for why a genuinely focusable trigger
   * (IconButton) wires shadcn's Tooltip directly instead of through this
   * wrapper; this component is for a non-focusable `children` snippet.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Tooltip from "./Tooltip.svelte";

  const { Story } = defineMeta({
    title: "Side panel/Tooltip",
    component: Tooltip,
    tags: ["autodocs"],
    args: { label: "Copied" },
  });
</script>

<!-- `children` is Tooltip's own required snippet prop, passed by name here
     for the same reason NoticeCard.stories.svelte's does. -->
{#snippet trigger()}
  <span class="inline-flex rounded-full bg-muted px-2 py-1 text-xs">Hover or focus me</span>
{/snippet}

<Story name="Top placement (default)">
  {#snippet template(args)}
    <Tooltip {...args} children={trigger} />
  {/snippet}
</Story>

<Story name="Bottom placement" args={{ placement: "bottom" }}>
  {#snippet template(args)}
    <Tooltip {...args} children={trigger} />
  {/snippet}
</Story>

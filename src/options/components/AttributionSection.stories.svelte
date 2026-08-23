<script module lang="ts">
  /**
   * Card 125 (decisions/42-storybook.md). Static content only — no props, no
   * services, no state (see the component's own header comment) — so this is
   * the simplest story in the options tree: one story, no args.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import AttributionSection from "./AttributionSection.svelte";

  const { Story } = defineMeta({
    title: "Options/AttributionSection",
    component: AttributionSection,
    tags: ["autodocs"],
  });
</script>

<Story name="Default" />

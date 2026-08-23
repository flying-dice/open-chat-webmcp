<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). Pure prop-driven badge row — the
   * four claim states a tool's own `annotations`/`mcpAnnotations` can put on
   * screen (ApprovalCard.svelte/ToolListItem.svelte/ToolCallRow.svelte all
   * share this derivation via card 81).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import AnnotationBadges from "./AnnotationBadges.svelte";

  const { Story } = defineMeta({
    title: "Side panel/AnnotationBadges",
    component: AnnotationBadges,
    tags: ["autodocs"],
  });
</script>

<Story name="Read-only" args={{ annotations: { readOnlyHint: true } }} />

<Story name="Untrusted content" args={{ annotations: { untrustedContentHint: true } }} />

<Story
  name="Server destructive"
  args={{ annotations: { untrustedContentHint: true }, mcpAnnotations: { destructiveHint: true } }}
/>

<Story name="Unannotated" args={{ annotations: {} }} />

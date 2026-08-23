<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). Top-level `inputSchema` renderer —
   * the "no schema" / "no parameters" / real-schema branches.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ToolSchema from "./ToolSchema.svelte";

  const { Story } = defineMeta({
    title: "Side panel/ToolSchema",
    component: ToolSchema,
    tags: ["autodocs"],
    args: {
      schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector to read." },
          maxLength: { type: "number" },
        },
        required: ["selector"],
      },
    },
  });
</script>

<Story name="With properties" />

<Story name="No parameters" args={{ schema: { type: "object", properties: {} } }} />

<Story name="No declared schema" args={{ schema: undefined }} />

<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). Recursive renderer for one
   * argument value — every branch of card 09's "scan for a hallucinated or
   * dangerous parameter" display.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ToolArgValue from "./ToolArgValue.svelte";

  const { Story } = defineMeta({
    title: "Side panel/ToolArgValue",
    component: ToolArgValue,
    tags: ["autodocs"],
    args: { value: "main" },
  });
</script>

<Story name="String" />

<Story name="Empty string" args={{ value: "" }} />

<Story name="Number" args={{ value: 42 }} />

<Story name="Boolean" args={{ value: true }} />

<Story name="Null" args={{ value: null }} />

<Story name="Undefined (not provided)" args={{ value: undefined }} />

<Story name="Array" args={{ value: ["main", "aside"] }} />

<Story name="Nested object" args={{ value: { selector: "main", options: { timeout: 5000 } } }} />

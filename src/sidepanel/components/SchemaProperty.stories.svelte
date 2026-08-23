<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). One property row in a tool's
   * `inputSchema` — untrusted, loosely JSON-Schema-shaped input
   * (decisions/02), recursing into `object`/`array` children via a
   * self-import.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import SchemaProperty from "./SchemaProperty.svelte";

  const { Story } = defineMeta({
    title: "Side panel/SchemaProperty",
    component: SchemaProperty,
    tags: ["autodocs"],
    args: {
      name: "query",
      node: { type: "string", description: "The search text." },
      required: true,
    },
  });
</script>

<Story name="Required string" />

<Story
  name="Enum with format"
  args={{
    name: "unit",
    node: { type: "string", format: "enum", enum: ["celsius", "fahrenheit"], description: "Temperature unit." },
    required: false,
  }}
/>

<Story
  name="Nested object"
  args={{
    name: "location",
    node: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lng: { type: "number" },
      },
      required: ["lat", "lng"],
    },
  }}
/>

<Story
  name="Array of objects"
  args={{
    name: "waypoints",
    node: {
      type: "array",
      items: {
        type: "object",
        properties: { lat: { type: "number" }, lng: { type: "number" } },
        required: ["lat"],
      },
    },
  }}
/>

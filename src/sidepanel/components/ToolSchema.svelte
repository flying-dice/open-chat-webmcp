<script lang="ts">
  /**
   * Top-level `inputSchema` renderer for one tool (card 11's "expandable
   * input schema" checklist item). Walks the root schema's `properties`
   * (falling back to an explicit "no parameters" / "no declared schema"
   * message) and hands each one to SchemaProperty.svelte, which recurses
   * into nested objects/arrays. `inputSchema` is untrusted page-supplied
   * JSON (decisions/02) and only loosely JSON-Schema-shaped, so every read
   * here is defensive.
   */
  import SchemaProperty from "./SchemaProperty.svelte";

  interface Props {
    schema: Record<string, unknown> | undefined;
  }

  let { schema }: Props = $props();

  function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  const properties = $derived(isRecord(schema?.properties) ? (schema.properties as Record<string, unknown>) : undefined);
  const required = $derived(
    Array.isArray(schema?.required)
      ? (schema.required as unknown[]).filter((r): r is string => typeof r === "string")
      : [],
  );
  const entries = $derived(properties ? Object.entries(properties) : []);
</script>

{#if !schema}
  <p class="no-schema text-small">This tool has no declared input schema.</p>
{:else if entries.length === 0}
  <p class="no-schema text-small">Takes no parameters.</p>
{:else}
  <div class="schema-props">
    {#each entries as [name, node] (name)}
      <SchemaProperty {name} {node} required={required.includes(name)} />
    {/each}
  </div>
{/if}

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .no-schema {
    margin: 0;
    font-style: italic;
  }

  .schema-props {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
</style>

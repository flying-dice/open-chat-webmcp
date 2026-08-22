<script lang="ts">
  /**
   * One property row in a tool's `inputSchema` (card 11 — the debugging
   * surface for decisions/02-mainworld-webmcp-bridge.md). Recurses via a
   * self-import (Svelte 5's supported pattern — `svelte:self` is
   * deprecated) the same way ToolArgValue.svelte recurses over argument
   * *values*; this is the schema-shape counterpart, walking `properties`/
   * `items` instead of live data. Deliberately not built on ToolArgValue —
   * that component renders a VALUE, this renders a TYPE DESCRIPTION
   * (type/required/enum/description), a different shape of information.
   *
   * `inputSchema` is untrusted, page-supplied JSON (decisions/02: "treat
   * every tool descriptor... as untrusted input") and only loosely
   * JSON-Schema-shaped in practice, so every field read here is defensive —
   * an unexpected shape degrades to "no further detail" rather than
   * throwing.
   *
   * Card 69 (decisions/28-shadcn-svelte-maia-zinc.md): scoped CSS replaced
   * with Tailwind utilities; recursion and field handling unchanged.
   */
  import {
    isRecord,
    readArray,
    readRecord,
    readString,
    readStringArray,
  } from "../presentation/untrustedJson";
  import Self from "./SchemaProperty.svelte";
  import { m } from "../../paraglide/messages.js";

  interface Props {
    name: string;
    node: unknown;
    required?: boolean;
  }

  let { name, node, required = false }: Props = $props();

  const rec = $derived(isRecord(node) ? node : undefined);
  const type = $derived(readString(rec, "type"));
  const description = $derived(readString(rec, "description"));
  const format = $derived(readString(rec, "format"));
  const enumValues = $derived(readArray(rec, "enum"));
  const properties = $derived(readRecord(rec, "properties"));
  const requiredList = $derived(readStringArray(rec, "required"));
  const items = $derived(rec?.items);
  const itemsRecord = $derived(isRecord(items) ? items : undefined);
  const itemProperties = $derived(readRecord(itemsRecord, "properties"));
  const itemRequiredList = $derived(readStringArray(itemsRecord, "required"));

  const typeLabel = $derived.by(() => {
    if (!type) return m.schemaProperty_anyType();
    if (type === "array") {
      const itemType = readString(itemsRecord, "type");
      return itemType ? m.schemaProperty_arrayOfType({ itemType }) : m.schemaProperty_arrayType();
    }
    return type;
  });
</script>

<div class="min-w-0">
  <div class="flex min-w-0 flex-wrap items-baseline gap-1">
    <span class="font-mono text-code font-semibold break-all">{name}</span>
    <span class="font-mono text-xs text-muted-foreground">{typeLabel}</span>
    {#if required}<span class="text-xs font-medium text-destructive">{m.schemaProperty_requiredLabel()}</span
      >{/if}
  </div>

  {#if description}<p class="mt-0.5 text-sm break-words text-muted-foreground">{description}</p>{/if}
  {#if format}<p class="mt-0.5 text-xs break-words text-muted-foreground"
      >{m.schemaProperty_formatLabel({ format })}</p
    >{/if}
  {#if enumValues && enumValues.length > 0}
    <p class="mt-0.5 text-xs break-words text-muted-foreground">
      {m.schemaProperty_oneOfLabel({ values: enumValues.map((v) => String(v)).join(", ") })}
    </p>
  {/if}

  {#if type === "object" && properties}
    <div class="mt-1 flex flex-col gap-2 border-l-2 border-border pl-2">
      {#each Object.entries(properties) as [childName, childNode] (childName)}
        <Self name={childName} node={childNode} required={requiredList.includes(childName)} />
      {/each}
    </div>
  {:else if type === "array" && itemProperties}
    <div class="mt-1 flex flex-col gap-2 border-l-2 border-border pl-2">
      <p class="text-xs text-muted-foreground">{m.schemaProperty_eachItemLabel()}</p>
      {#each Object.entries(itemProperties) as [childName, childNode] (childName)}
        <Self name={childName} node={childNode} required={itemRequiredList.includes(childName)} />
      {/each}
    </div>
  {/if}
</div>

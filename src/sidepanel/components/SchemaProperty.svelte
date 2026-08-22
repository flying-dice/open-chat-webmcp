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
  import Self from "./SchemaProperty.svelte";

  interface Props {
    name: string;
    node: unknown;
    required?: boolean;
  }

  let { name, node, required = false }: Props = $props();

  function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  const rec = $derived(isRecord(node) ? node : undefined);
  const type = $derived(typeof rec?.type === "string" ? (rec.type as string) : undefined);
  const description = $derived(
    typeof rec?.description === "string" ? (rec.description as string) : undefined,
  );
  const format = $derived(typeof rec?.format === "string" ? (rec.format as string) : undefined);
  const enumValues = $derived(Array.isArray(rec?.enum) ? (rec.enum as unknown[]) : undefined);
  const properties = $derived(isRecord(rec?.properties) ? (rec.properties as Record<string, unknown>) : undefined);
  const requiredList = $derived(
    Array.isArray(rec?.required)
      ? (rec.required as unknown[]).filter((r): r is string => typeof r === "string")
      : [],
  );
  const items = $derived(rec?.items);
  const itemsRecord = $derived(isRecord(items) ? items : undefined);
  const itemProperties = $derived(
    isRecord(itemsRecord?.properties) ? (itemsRecord.properties as Record<string, unknown>) : undefined,
  );
  const itemRequiredList = $derived(
    Array.isArray(itemsRecord?.required)
      ? (itemsRecord.required as unknown[]).filter((r): r is string => typeof r === "string")
      : [],
  );

  const typeLabel = $derived.by(() => {
    if (!type) return "any";
    if (type === "array") {
      const itemType = typeof itemsRecord?.type === "string" ? (itemsRecord.type as string) : undefined;
      return itemType ? `array<${itemType}>` : "array";
    }
    return type;
  });
</script>

<div class="min-w-0">
  <div class="flex min-w-0 flex-wrap items-baseline gap-1">
    <span class="font-mono font-semibold break-all">{name}</span>
    <span class="font-mono text-xs text-muted-foreground">{typeLabel}</span>
    {#if required}<span class="text-xs font-medium text-destructive">required</span>{/if}
  </div>

  {#if description}<p class="mt-0.5 text-sm break-words text-muted-foreground">{description}</p>{/if}
  {#if format}<p class="mt-0.5 text-xs break-words text-muted-foreground">format: {format}</p>{/if}
  {#if enumValues && enumValues.length > 0}
    <p class="mt-0.5 text-xs break-words text-muted-foreground">
      one of: {enumValues.map((v) => String(v)).join(", ")}
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
      <p class="text-xs text-muted-foreground">each item:</p>
      {#each Object.entries(itemProperties) as [childName, childNode] (childName)}
        <Self name={childName} node={childNode} required={itemRequiredList.includes(childName)} />
      {/each}
    </div>
  {/if}
</div>

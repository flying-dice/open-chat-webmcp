<script lang="ts">
  /**
   * One tool card in the Tools view (card 11): name, description, and
   * annotations — the single most useful thing for debugging why a WebMCP
   * site does or doesn't work as expected. The input schema is collapsed by
   * default (it's the least-often-needed detail) behind the same
   * chevron-button pattern ToolCallRow.svelte uses.
   *
   * There is no `source` badge any more (native / polyfill / our shim):
   * decisions/16-native-webmcp-client.md deleted the MAIN-world bridge that
   * made that distinction meaningful. Every tool that reaches this view came
   * straight from `document.modelContext.getTools()` — it's native or it
   * isn't shown at all.
   *
   * Per decisions/05 and decisions/17, `annotations` are reported by the page
   * itself and are not a security guarantee — the badges here say only what
   * the page claims, same wording discipline as
   * ApprovalCard.svelte/ToolCallRow.svelte. `ToolAnnotations` is exactly
   * `{ readOnlyHint, untrustedContentHint }` — there is no `destructiveHint`
   * (decisions/17): it isn't in the WebMCP IDL, and Chrome's WebIDL
   * dictionary conversion silently drops any unknown member a page sets, so
   * it's a field that's always absent, not merely unused.
   *
   * Card 38 (decisions/19 §6): every tool now also carries `origin` — "this
   * page" or a server's display name — rendered as its own badge so a
   * remote tool can never be mistaken for one this page published itself.
   * A server tool's `mcpAnnotations` (decisions/19 §2), when present, adds
   * its own display-only badges alongside the normalised ones above;
   * `destructiveHint`/`idempotentHint`/`openWorldHint` never affect approval.
   *
   * Card 69 (decisions/28-shadcn-svelte-maia-zinc.md): re-skinned onto
   * shadcn's Card + Collapsible + Badge. The schema toggle keeps the same
   * collapsed-by-default behaviour, now driven by Collapsible's own `open`
   * state instead of a hand-rolled boolean + `{#if}`.
   */
  import type { SerializedTool, ToolAnnotations } from "../../lib/protocol";
  import type { McpToolAnnotations } from "../../lib/mcp/types";
  import { originLabel, type ToolOrigin } from "../../lib/mcp/merge";
  import ToolSchema from "./ToolSchema.svelte";
  import * as Card from "$lib/components/ui/card";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Badge } from "$lib/components/ui/badge";

  interface Props {
    tool: Pick<SerializedTool, "name" | "description" | "inputSchema"> & {
      annotations?: ToolAnnotations;
      mcpAnnotations?: McpToolAnnotations;
      origin: ToolOrigin;
    };
  }

  let { tool }: Props = $props();

  let expanded = $state(false);

  const readOnly = $derived(tool.annotations?.readOnlyHint === true);
  const untrustedContent = $derived(tool.annotations?.untrustedContentHint === true);
  const unannotated = $derived(!tool.annotations || (!readOnly && !untrustedContent));
  const isServerTool = $derived(tool.origin.kind === "server");
  const destructive = $derived(tool.mcpAnnotations?.destructiveHint === true);
</script>

<Card.Root size="sm" class="w-full min-w-0 gap-2">
  <Card.Content class="flex min-w-0 flex-col gap-1">
    <div class="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
      <span class="min-w-0 font-mono font-semibold break-words">{tool.name}</span>
      <span class="flex flex-wrap justify-end gap-1">
        <Badge variant="outline" class={isServerTool ? "border-primary text-primary" : ""}>
          {originLabel(tool.origin)}
        </Badge>
        {#if readOnly}
          <Badge variant="outline">read-only</Badge>
        {/if}
        {#if untrustedContent}
          <Badge variant="destructive">untrusted content</Badge>
        {/if}
        {#if destructive}
          <Badge variant="destructive">server: destructive</Badge>
        {/if}
        {#if unannotated}
          <Badge variant="outline" class="border-dashed text-muted-foreground">unannotated</Badge>
        {/if}
      </span>
    </div>

    {#if tool.description}
      <p class="text-sm break-words text-muted-foreground">{tool.description}</p>
    {/if}

    <Collapsible.Root bind:open={expanded}>
      <Collapsible.Trigger
        class="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
      >
        <span
          class="inline-block text-xs transition-transform duration-150"
          class:rotate-90={expanded}
          aria-hidden="true">▸</span
        >
        Input schema
      </Collapsible.Trigger>

      <Collapsible.Content class="mt-2 min-w-0 rounded-lg bg-muted/50 p-2">
        <ToolSchema schema={tool.inputSchema} />
      </Collapsible.Content>
    </Collapsible.Root>
  </Card.Content>
</Card.Root>

<script lang="ts">
  /**
   * The badge row for what a tool CLAIMS about itself — read-only, untrusted
   * content, a server's `destructiveHint`, or nothing at all.
   *
   * Card 81 extracted this from ApprovalCard.svelte and ToolListItem.svelte,
   * which derived the same four booleans and rendered the same four
   * conditional badges twice over. Both places are answering the same
   * question about the same data, so a change to what counts as "unannotated"
   * — or to how loudly "untrusted content" reads — now lands in one file
   * instead of needing to be mirrored by hand.
   *
   * Per decisions/05 and decisions/17 these are the PAGE's (or the MCP
   * server's) own claims, never a guarantee the extension verified; the
   * wording stays deliberately claim-shaped for that reason. `ToolAnnotations`
   * is exactly `{ readOnlyHint, untrustedContentHint }` — `destructiveHint`
   * exists only on a server tool's `mcpAnnotations` (decisions/19 §2) and is
   * display-only: it never affects approval.
   *
   * Renders the badges bare, with no wrapper of its own, so each caller keeps
   * its own row layout (ToolListItem puts an origin badge alongside them).
   */
  import type { McpToolAnnotations, ToolAnnotations } from "../../domain/tools";
  import { Badge } from "$lib/components/ui/badge";

  interface Props {
    /** The tool's normalised WebMCP annotations, absent when the tool declared none — or when the tool itself is unknown. */
    annotations?: ToolAnnotations;
    /** A server tool's raw MCP annotations (decisions/19 §2), absent for a page tool. */
    mcpAnnotations?: McpToolAnnotations;
  }

  let { annotations, mcpAnnotations }: Props = $props();

  const readOnly = $derived(annotations?.readOnlyHint === true);
  const untrustedContent = $derived(annotations?.untrustedContentHint === true);
  const unannotated = $derived(!annotations || (!readOnly && !untrustedContent));
  const destructive = $derived(mcpAnnotations?.destructiveHint === true);
</script>

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

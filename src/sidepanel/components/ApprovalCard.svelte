<script lang="ts">
  /**
   * The blocking approve/deny card (card 09, decisions/05). Rendered by
   * Transcript.svelte, once per entry in `approvals.pending`
   * (src/sidepanel/stores/approvals.svelte.ts) — the agent loop is
   * genuinely suspended (`await`ing this decision) for as long as this card
   * is on screen, so it takes focus the moment it appears and stays fully
   * keyboard-operable.
   *
   * Focus lands on Deny, not Approve: this is the safe default under
   * decisions/05's fail-closed posture — an accidental Enter press denies
   * rather than acting on a live, possibly logged-in, page — and Approve is
   * exactly one Tab away, never harder to reach than Deny (card 09
   * checklist). Deny is also styled with the same danger colour the
   * composer's Stop button uses, not because denying is dangerous but so a
   * scanning eye can tell the two buttons apart at a glance.
   *
   * Per decisions/05 and decisions/17: `annotations` are supplied by the
   * PAGE, not the extension, and are not a security boundary — a hostile
   * page could label a mutating tool read-only, or omit
   * `untrustedContentHint` on a tool returning attacker-controlled text. The
   * badges below are worded as reports ("the page marked this...") and the
   * arguments panel is the actual substance of the decision, not the badges.
   * `ToolAnnotations` is exactly `{ readOnlyHint, untrustedContentHint }` —
   * there is no `destructiveHint` (decisions/17: not in the WebMCP IDL, and
   * silently dropped by Chrome's WebIDL dictionary conversion even if a page
   * sets it).
   *
   * Card 38 (decisions/19 §6): `request.tool` now comes from the MERGED
   * tool list, so it also carries `origin` — this is THE moment a user must
   * not mistake a remote action for a local one, so the origin line is not
   * a badge among others here, it's its own prominent statement right under
   * the tool name. A server tool's own `mcpAnnotations` (decisions/19 §2)
   * are shown too, display-only — `destructiveHint` may only raise visual
   * prominence, never approval behaviour.
   *
   * decisions/20-approval-policy-is-per-tool-source.md: this card is reached
   * under two DIFFERENT policies depending on `request.tool.origin` — a
   * page tool by the unchanged decisions/05/17 rule, a server tool by its
   * own, stricter, independent `McpApprovalPolicy` (default
   * "always-confirm": every server call asks regardless of
   * `readOnlyHint`). This component itself doesn't decide which — that
   * happens in src/sidepanel/services/agentLoop.ts before this card is ever
   * shown — it only has to make the difference visible (the origin line
   * above) and remember approvals in the right scope (see the "don't ask
   * again" label below, and src/sidepanel/stores/approvals.svelte.ts's two
   * separate skip-lists).
   *
   * Card 69 (decisions/28-shadcn-svelte-maia-zinc.md): re-skinned onto
   * shadcn's Card + Button + Badge. All behaviour — focus-on-mount, tab
   * order, approve/deny/skip-for-session semantics — is unchanged; only the
   * markup and styling moved off hand-written CSS.
   */
  import type { PendingApproval } from "../stores/approvals.svelte";
  import { approve, deny } from "../stores/approvals.svelte";
  import { originLabel } from "../../lib/mcp/merge";
  import ToolArgs from "./ToolArgs.svelte";
  import * as Card from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Label } from "$lib/components/ui/label";

  interface Props {
    request: PendingApproval;
  }

  let { request }: Props = $props();

  let remember = $state(false);
  let denyButton = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    // Runs once when this card mounts (a fresh `request.id` never recurs —
    // approvals.svelte.ts removes an entry the instant it's settled). See
    // the header comment for why Deny, specifically, gets the focus.
    denyButton?.focus();
  });

  const tool = $derived(request.tool);
  const readOnly = $derived(tool?.annotations?.readOnlyHint === true);
  const untrustedContent = $derived(tool?.annotations?.untrustedContentHint === true);
  const unannotated = $derived(!tool?.annotations || (!readOnly && !untrustedContent));
  const isServerTool = $derived(tool?.origin.kind === "server");
  const destructive = $derived(tool?.mcpAnnotations?.destructiveHint === true);
</script>

<Card.Root
  role="group"
  aria-label={`Approval needed: ${request.call.name}`}
  class="w-full min-w-0 gap-3 ring-2 ring-primary/30"
>
  <Card.Header>
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Approval needed</span>
      <div class="flex flex-wrap justify-end gap-1">
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
      </div>
    </div>
    <Card.Title class="font-mono text-base font-semibold break-words">{request.call.name}</Card.Title>
  </Card.Header>

  <Card.Content class="flex flex-col gap-3">
    <p class="text-sm" class:text-primary={isServerTool} class:font-semibold={isServerTool}>
      {#if tool === undefined}
        Origin unknown — this name isn't in the current tool list.
      {:else}
        Runs on <strong>{originLabel(tool.origin)}</strong>{isServerTool ? " (a remote MCP server, not this page)" : ""}.
      {/if}
    </p>

    {#if tool === undefined}
      <p class="text-sm text-destructive">
        This tool isn't in the current tool list — it may be a hallucinated
        name, or a tool that was unregistered/removed after the model
        requested it. Review the arguments below carefully before approving.
      </p>
    {:else if tool.description}
      <p class="text-sm text-muted-foreground">{tool.description}</p>
    {/if}

    <p class="text-sm text-muted-foreground">
      These hints are reported by {isServerTool ? "the MCP server" : "the page"} itself, not verified by
      the extension — treat them as a guide, not a guarantee.
    </p>

    <div>
      <h3 class="mb-1 text-sm font-medium">Arguments</h3>
      <ToolArgs args={request.call.arguments} />
    </div>

    <Label class="items-center gap-2 text-sm font-normal text-muted-foreground">
      <input
        type="checkbox"
        bind:checked={remember}
        class="size-4 shrink-0 rounded border-input accent-primary"
      />
      {#if isServerTool}
        Don't ask again for this tool on this server (this session)
      {:else}
        Don't ask again for this tool on this page (this session)
      {/if}
    </Label>
  </Card.Content>

  <Card.Footer class="flex justify-end gap-2">
    <Button type="button" variant="destructive" bind:ref={denyButton} onclick={() => deny(request.id)}>
      Deny
    </Button>
    <Button type="button" variant="default" onclick={() => approve(request.id, remember)}>
      Approve
    </Button>
  </Card.Footer>
</Card.Root>

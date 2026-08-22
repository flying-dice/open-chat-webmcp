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
   * happens in src/domain/chat/turn.ts before this card is ever
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
  import { originLabel } from "../presentation/toolOrigin";
  import { isolateLtr } from "../../ui/bidi";
  import AnnotationBadges from "./AnnotationBadges.svelte";
  import ToolArgs from "./ToolArgs.svelte";
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { Label } from "$lib/components/ui/label";
  import { m } from "../../paraglide/messages.js";

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
  const isServerTool = $derived(tool?.origin.kind === "server");
</script>

<Card.Root
  role="group"
  aria-label={m.approvalCard_ariaLabel({ name: isolateLtr(request.call.name) })}
  class="w-full min-w-0 gap-3 ring-2 ring-primary/30"
>
  <Card.Header>
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >{m.approvalCard_heading()}</span
      >
      <div class="flex flex-wrap justify-end gap-1">
        <AnnotationBadges annotations={tool?.annotations} mcpAnnotations={tool?.mcpAnnotations} />
      </div>
    </div>
    <Card.Title class="font-mono text-sm font-semibold break-words" dir="ltr">{request.call.name}</Card.Title>
  </Card.Header>

  <Card.Content class="flex flex-col gap-3">
    <p class="text-sm" class:text-primary={isServerTool} class:font-semibold={isServerTool}>
      {#if tool === undefined}
        {m.approvalCard_originUnknown()}
      {:else}
        {m.approvalCard_runsOnPrefix()}<strong dir="ltr">{originLabel(tool.origin)}</strong>{isServerTool
          ? m.approvalCard_runsOnServerSuffix()
          : m.approvalCard_runsOnPageSuffix()}
      {/if}
    </p>

    {#if tool === undefined}
      <p class="text-sm text-destructive">
        {m.approvalCard_unknownToolWarning()}
      </p>
    {:else if tool.description}
      <p class="text-sm text-muted-foreground">{tool.description}</p>
    {/if}

    <p class="text-sm text-muted-foreground">
      {isServerTool ? m.approvalCard_hintsDisclaimerServer() : m.approvalCard_hintsDisclaimerPage()}
    </p>

    <div>
      <h3 class="mb-1 text-sm font-medium">{m.argumentsHeading()}</h3>
      <ToolArgs args={request.call.arguments} />
    </div>

    <Label class="items-center gap-2 text-sm font-normal text-muted-foreground">
      <input
        type="checkbox"
        bind:checked={remember}
        class="size-4 shrink-0 rounded border-input accent-primary"
      />
      {isServerTool ? m.approvalCard_skipServerLabel() : m.approvalCard_skipPageLabel()}
    </Label>
  </Card.Content>

  <Card.Footer class="flex justify-end gap-2">
    <Button type="button" variant="destructive" bind:ref={denyButton} onclick={() => deny(request.id)}>
      {m.approvalCard_denyAction()}
    </Button>
    <Button type="button" variant="default" onclick={() => approve(request.id, remember)}>
      {m.approvalCard_approveAction()}
    </Button>
  </Card.Footer>
</Card.Root>

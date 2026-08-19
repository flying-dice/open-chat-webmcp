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
   * composer's Stop button uses (src/lib/theme.css's `--color-danger`), not
   * because denying is dangerous but so a scanning eye can tell the two
   * buttons apart at a glance.
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
   */
  import type { PendingApproval } from "../stores/approvals.svelte";
  import { approve, deny } from "../stores/approvals.svelte";
  import { originLabel } from "../../lib/mcp/merge";
  import ToolArgs from "./ToolArgs.svelte";

  interface Props {
    request: PendingApproval;
  }

  let { request }: Props = $props();

  let remember = $state(false);
  let denyButton: HTMLButtonElement | undefined = $state();

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

<div class="approval-card" role="group" aria-label={`Approval needed: ${request.call.name}`}>
  <div class="approval-heading">
    <span class="eyebrow text-small">Approval needed</span>
    <div class="badges">
      {#if readOnly}
        <span class="badge badge-readonly">read-only</span>
      {/if}
      {#if untrustedContent}
        <span class="badge badge-untrusted">untrusted content</span>
      {/if}
      {#if destructive}
        <span class="badge badge-untrusted">server: destructive</span>
      {/if}
      {#if unannotated}
        <span class="badge badge-unannotated">unannotated</span>
      {/if}
    </div>
  </div>

  <p class="tool-name">{request.call.name}</p>

  <p class="origin-line" class:origin-remote={isServerTool}>
    {#if tool === undefined}
      Origin unknown — this name isn't in the current tool list.
    {:else}
      Runs on <strong>{originLabel(tool.origin)}</strong>{isServerTool ? " (a remote MCP server, not this page)" : ""}.
    {/if}
  </p>

  {#if tool === undefined}
    <p class="warning text-small">
      This tool isn't in the current tool list — it may be a hallucinated
      name, or a tool that was unregistered/removed after the model
      requested it. Review the arguments below carefully before approving.
    </p>
  {:else if tool.description}
    <p class="description text-small">{tool.description}</p>
  {/if}

  <p class="disclaimer text-small">
    These hints are reported by {isServerTool ? "the MCP server" : "the page"} itself, not verified by
    the extension — treat them as a guide, not a guarantee.
  </p>

  <div class="args-section">
    <h3>Arguments</h3>
    <ToolArgs args={request.call.arguments} />
  </div>

  <label class="remember text-small">
    <input type="checkbox" bind:checked={remember} />
    {#if isServerTool}
      Don't ask again for this tool on this server (this session)
    {:else}
      Don't ask again for this tool on this page (this session)
    {/if}
  </label>

  <div class="actions">
    <button type="button" bind:this={denyButton} class="deny-button" onclick={() => deny(request.id)}>
      Deny
    </button>
    <button type="button" class="approve-button" onclick={() => approve(request.id, remember)}>
      Approve
    </button>
  </div>
</div>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     and src/sidepanel/chat-theme.css (decisions/18). */

  /* The one thing in the transcript that BLOCKS the loop, so it is the one
     thing tinted rather than merely filled — it has to be distinguishable
     from an ordinary tool card at a glance, and the 3px accent border it
     used to rely on reads as decoration now that nothing else has one. */
  .approval-card {
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border: none;
    border-radius: var(--radius-lg);
    background: var(--color-secondary-container);
    color: var(--color-on-secondary-container);
    padding: var(--space-4);
  }

  .approval-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--color-on-surface-variant);
  }

  .badges {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .badge {
    font-size: var(--font-size-small);
    line-height: 1;
    padding: 2px var(--space-1);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-outline);
    /* The card's own fill is the secondary container, so badges need their
       own surface to stay legible against it rather than inheriting it. */
    background: var(--color-surface);
    white-space: nowrap;
  }

  .badge-readonly {
    color: var(--color-on-surface-variant);
  }

  /* theme.css has no separate "warning" token (decisions/08) — this reuses
     --color-danger, the only attention colour available, purely to catch
     the eye; it does not imply the call itself is dangerous to make. */
  .badge-untrusted {
    color: var(--color-danger);
    border-color: var(--color-danger);
  }

  .badge-unannotated {
    color: var(--color-on-surface-variant);
    border-style: dashed;
  }

  .tool-name {
    margin: 0;
    font-family: var(--font-family-mono);
    font-size: var(--font-size-heading);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .description,
  .disclaimer {
    margin: 0;
    color: var(--color-on-surface-variant);
  }

  /* Decisions/19 §6: where a call runs is stated plainly, not buried in a
     badge — neutral for the page (the common case), tinted primary and bold
     for a remote server so it reads as a distinct fact, not decoration. */
  .origin-line {
    margin: 0;
    color: var(--color-on-surface-variant);
  }

  .origin-line.origin-remote {
    color: var(--color-primary);
    font-weight: 600;
  }

  .warning {
    margin: 0;
    color: var(--color-danger);
  }

  .args-section h3 {
    margin-bottom: var(--space-1);
  }

  .remember {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-on-surface-variant);
  }

  .remember input {
    margin: 0;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .actions button {
    flex: 0 0 auto;
  }

  /* Buttons no longer have borders to colour (chat-theme.css), so the
     approve/deny distinction is carried by fill and weight instead: approve
     is the filled primary action, deny is a quieter tonal button in the
     danger colour. Deny stays the autofocused one — see the markup. */
  .deny-button {
    background: var(--color-surface-container);
    color: var(--color-danger);
  }

  .deny-button:hover {
    background: var(--color-surface-container-high);
  }

  .approve-button {
    background: var(--color-primary);
    color: var(--color-on-primary);
  }

  .approve-button:hover {
    background: color-mix(in srgb, var(--color-on-primary) 8%, var(--color-primary));
  }
</style>

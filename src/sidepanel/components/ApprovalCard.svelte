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
   * Per decisions/05: `annotations` are supplied by the PAGE, not the
   * extension, and are not a security boundary — a hostile page could label
   * a destructive tool read-only. The badges below are worded as reports
   * ("the page marked this...") and the arguments panel is the actual
   * substance of the decision, not the badges.
   */
  import type { PendingApproval } from "../stores/approvals.svelte";
  import { approve, deny } from "../stores/approvals.svelte";
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
  const destructive = $derived(tool?.annotations?.destructiveHint === true);
  const unannotated = $derived(!tool?.annotations || (!readOnly && !destructive));
</script>

<div class="approval-card" data-destructive={destructive} role="group" aria-label={`Approval needed: ${request.call.name}`}>
  <div class="approval-heading">
    <span class="eyebrow text-small">Approval needed</span>
    <div class="badges">
      {#if destructive}
        <span class="badge badge-destructive">destructive</span>
      {/if}
      {#if readOnly}
        <span class="badge badge-readonly">read-only</span>
      {/if}
      {#if unannotated}
        <span class="badge badge-unannotated">unannotated</span>
      {/if}
    </div>
  </div>

  <p class="tool-name">{request.call.name}</p>

  {#if tool === undefined}
    <p class="warning text-small">
      This tool isn't in the page's current tool list — it may be a
      hallucinated name, or a tool that was unregistered after the model
      requested it. Review the arguments below carefully before approving.
    </p>
  {:else if tool.description}
    <p class="description text-small">{tool.description}</p>
  {/if}

  <p class="disclaimer text-small">
    These hints are reported by the page itself, not verified by the
    extension — treat them as a guide, not a guarantee.
  </p>

  <div class="args-section">
    <h3>Arguments</h3>
    <ToolArgs args={request.call.arguments} />
  </div>

  <label class="remember text-small">
    <input type="checkbox" bind:checked={remember} />
    Don't ask again for this tool on this page (this session)
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
     (decisions/08-native-chrome-design-language.md). */

  .approval-card {
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border: 1px solid var(--color-outline);
    border-left: 3px solid var(--color-primary);
    border-radius: var(--radius-card);
    background: var(--color-surface);
    padding: var(--space-3);
  }

  .approval-card[data-destructive="true"] {
    border-left-color: var(--color-danger);
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
    white-space: nowrap;
  }

  .badge-destructive {
    background: var(--color-danger);
    border-color: var(--color-danger);
    color: var(--color-on-primary);
    font-weight: 600;
  }

  .badge-readonly {
    color: var(--color-on-surface-variant);
  }

  .badge-unannotated {
    color: var(--color-on-surface-variant);
    border-style: dashed;
  }

  .tool-name {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: var(--font-size-heading);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .description,
  .disclaimer {
    margin: 0;
    color: var(--color-on-surface-variant);
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

  .deny-button {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }

  .approve-button {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
</style>

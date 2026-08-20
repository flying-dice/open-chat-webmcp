<script lang="ts">
  /**
   * The timeline for one activity group (card 61): a summary button plus a
   * rail of `ToolCallRow`s. Deliberately NOT a filled card — it sits on the
   * panel surface exactly like the assistant's bare-text prose turn
   * (decisions/18); the rail is its only structure.
   *
   * Expansion default (decisions/26):
   *   - live (this group is the transcript's currently in-flight one) →
   *     expanded, so a running call is visible as it happens.
   *   - the reply lands → `live` goes false → it collapses automatically.
   *   - an error or a denied call anywhere in the group → stays expanded
   *     regardless of `live` (a group must never hide that something needs
   *     attention behind one click).
   *   - one user click pins whichever state the user chose, overriding the
   *     auto behaviour for the rest of this component instance's lifetime.
   *
   * This is deliberately NOT `ToolCallCard.svelte`'s old
   * `untrack(() => message.toolMode !== "auto")` pattern (that file,
   * ~:47-51): that default was read ONCE at mount and never meant to
   * change again — a call's approval mode is fixed for its lifetime. A
   * group's default DOES change over time (live → done is exactly the
   * transition that matters here), so the default itself has to stay
   * reactive; only the user's OWN override needs to be sticky, which is
   * what `userToggled`/`userExpanded` capture below without any `$effect`.
   */
  import type { PanelMessage } from "../stores/panel.svelte";
  import { summariseActivity } from "../lib/transcriptGroups";
  import ToolCallRow from "./ToolCallRow.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    steps: PanelMessage[];
    live: boolean;
  }

  let { steps, live }: Props = $props();

  let userToggled = $state(false);
  let userExpanded = $state(false);

  const summary = $derived(summariseActivity(steps));
  const autoOpen = $derived(live || summary.needsAttention);
  const expanded = $derived(userToggled ? userExpanded : autoOpen);

  function toggle(): void {
    userExpanded = !expanded;
    userToggled = true;
  }

  /**
   * Collapsed summary text — a `·`-joined line of plain facts, never an
   * invented verb (decisions/26). Must never hide that a remote server was
   * called or that a human approved/denied something (decisions/05,
   * decisions/19 §6), so `via <server>` and the approved/denied counts are
   * part of the collapsed row itself, not only visible once expanded.
   */
  const summaryText = $derived.by((): string => {
    const parts = [summary.countLabel];
    if (summary.namesLabel) parts.push(summary.namesLabel);
    if (summary.serverNames.length > 0) parts.push(`via ${summary.serverNames.join(", ")}`);
    if (summary.errorCount > 0) parts.push(`${summary.errorCount} failed`);
    if (summary.deniedCount > 0) parts.push(`${summary.deniedCount} denied`);
    if (summary.approvedCount > 0) parts.push(`${summary.approvedCount} approved`);
    return parts.join(" · ");
  });
</script>

<div class="activity-group">
  <button type="button" class="summary" aria-expanded={expanded} onclick={toggle}>
    <span class="summary-icon" aria-hidden="true"><Icon name="build" size={16} /></span>
    <span class="summary-text">{summaryText}</span>
    <span class="chevron" class:open={expanded} aria-hidden="true"
      ><Icon name="chevron_right" size={16} /></span
    >
  </button>

  {#if expanded}
    <ol class="timeline">
      {#each steps as step (step.id)}
        <ToolCallRow message={step} {live} />
      {/each}
    </ol>
  {/if}
</div>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     and src/sidepanel/chat-theme.css (decisions/18). */

  .activity-group {
    width: 100%;
    min-width: 0;
  }

  .summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
    padding: var(--space-1) 0;
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--color-on-surface-variant);
    font-size: var(--font-size-small);
    text-align: left;
  }

  .summary:hover .summary-text {
    text-decoration: underline;
  }

  .summary-icon {
    display: inline-flex;
    flex: none;
  }

  .summary-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    flex: none;
    display: inline-flex;
    transition: transform var(--transition-fast);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  /* Rail budget: at a 320px panel the transcript content is 288px; this
     costs roughly 20px (12px dot column + var(--space-2) gap). */
  .timeline {
    position: relative;
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .timeline::before {
    content: "";
    position: absolute;
    left: 5px;
    top: 10px;
    bottom: 10px;
    width: 2px;
    border-radius: 1px;
    background: var(--color-outline-variant);
  }
</style>

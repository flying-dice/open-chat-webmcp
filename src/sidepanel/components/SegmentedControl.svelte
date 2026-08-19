<script lang="ts">
  /**
   * A generic native-feeling pill tab-strip (decisions/08-native-chrome-
   * design-language.md — no custom widget kit, just the same pill radius/
   * spacing tokens every other control uses). Used twice by card 11: the
   * chat/inspector switch in App.svelte, and the Tools/Call Log switch
   * inside Inspector.svelte. Deliberately not tied to either — a bare
   * `{value, label}` list plus a callback, so a third use elsewhere costs
   * nothing.
   */
  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    options: Option[];
    value: string;
    onSelect: (value: string) => void;
    ariaLabel: string;
  }

  let { options, value, onSelect, ariaLabel }: Props = $props();
</script>

<div class="segmented" role="tablist" aria-label={ariaLabel}>
  {#each options as opt (opt.value)}
    <button
      type="button"
      role="tab"
      aria-selected={value === opt.value}
      class:active={value === opt.value}
      onclick={() => onSelect(opt.value)}
    >
      {opt.label}
    </button>
  {/each}
</div>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     and src/sidepanel/chat-theme.css (decisions/18). */

  .segmented {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    background: var(--color-surface-container);
    border-radius: var(--radius-full);
    border: none;
    min-width: 0;
  }

  .segmented button {
    flex: 1 1 auto;
    min-width: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-full);
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background-color var(--transition-fast);
  }

  .segmented button.active {
    background: var(--color-secondary-container);
    color: var(--color-on-secondary-container);
    font-weight: 500;
  }

  .segmented button:hover:not(.active) {
    background: var(--state-hover);
  }
</style>

<script lang="ts">
  /**
   * A Material 3 plain tooltip: inverse-surface chip, shown on hover and on
   * :focus-visible so keyboard users get it too.
   *
   * Pure CSS — no timers, no positioning library, no portal. The bubble is
   * absolutely positioned against the wrapper and hidden with
   * `visibility`/`opacity` so it never affects layout or hit-testing. The
   * appearance delay is a transition-delay, which means moving the pointer
   * across a row of icon buttons doesn't strobe tooltips: each one has to
   * survive the delay on its own.
   *
   * `pointer-events: none` on the bubble matters — a tooltip that can be
   * hovered would flicker as it appears under the cursor.
   */
  import type { Snippet } from "svelte";

  interface Props {
    /** The tooltip text. */
    label: string;
    /** Which side of the trigger the bubble sits on. */
    placement?: "top" | "bottom";
    children: Snippet;
  }

  const { label, placement = "top", children }: Props = $props();
</script>

<span class="tooltip-wrap" data-placement={placement}>
  {@render children()}
  <!-- aria-hidden: the trigger carries its own aria-label, so exposing this
       too would make screen readers announce the name twice. -->
  <span class="tooltip" aria-hidden="true">{label}</span>
</span>

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css and
     src/sidepanel/chat-theme.css. */
  .tooltip-wrap {
    position: relative;
    display: inline-flex;
  }

  .tooltip {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-inverse-surface);
    color: var(--color-inverse-on-surface);
    font-size: var(--font-size-caption);
    line-height: 1.3;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition:
      opacity var(--transition-fast),
      visibility var(--transition-fast);
  }

  .tooltip-wrap[data-placement="top"] .tooltip {
    bottom: calc(100% + var(--space-1));
  }

  .tooltip-wrap[data-placement="bottom"] .tooltip {
    top: calc(100% + var(--space-1));
  }

  .tooltip-wrap:hover .tooltip,
  .tooltip-wrap:focus-within .tooltip {
    opacity: 1;
    visibility: visible;
    /* Delay only on the way in: dismissal should feel immediate. */
    transition-delay: 500ms;
  }

  @media (prefers-reduced-motion: reduce) {
    .tooltip {
      transition: none;
    }
  }
</style>

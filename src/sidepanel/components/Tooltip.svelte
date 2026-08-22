<script lang="ts">
  /**
   * A generic hover/focus tooltip, now backed by shadcn-svelte's Tooltip
   * (bits-ui) instead of a hand-rolled CSS bubble (decisions/28). Kept as
   * its own component with the same `label`/`placement`/`children` API as
   * before Tooltip.Trigger's props are attached to a wrapping
   * `display:contents` span around `children` rather than to `children`
   * itself, so this stays a drop-in wrap-anything tooltip for callers like
   * MessageActions.svelte's "Copied" badge (out of this card's scope, and
   * not itself focusable, so the span-level wiring covers it exactly).
   *
   * A genuinely focusable trigger (e.g. IconButton.svelte's button) wires
   * shadcn's Tooltip.Trigger directly onto itself instead — a wrapping
   * span never becomes `document.activeElement`, so `onfocus`/`onblur`
   * delegated through one would never fire, and the tooltip would silently
   * stop appearing for keyboard users. IconButton.svelte therefore doesn't
   * use this component.
   *
   * Each instance carries its own Tooltip.Provider — simpler than wiring
   * one at the app root, and cheap: bits-ui's Provider only sets a shared
   * `delayDuration` for grouping, which nothing here relies on.
   */
  import type { Snippet } from "svelte";
  import * as TooltipPrimitive from "$lib/components/ui/tooltip";

  interface Props {
    /** The tooltip text. */
    label: string;
    /** Which side of the trigger the bubble sits on. */
    placement?: "top" | "bottom";
    children: Snippet;
  }

  const { label, placement = "top", children }: Props = $props();
</script>

<TooltipPrimitive.Provider>
  <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger>
      {#snippet child({ props })}
        <span {...props} class="contents">
          {@render children()}
        </span>
      {/snippet}
    </TooltipPrimitive.Trigger>
    <TooltipPrimitive.Content side={placement}>
      {label}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Root>
</TooltipPrimitive.Provider>

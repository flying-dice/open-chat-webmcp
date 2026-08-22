<script lang="ts">
  /**
   * A round icon button: shadcn's Button (`variant="ghost"`, `size="icon"`/
   * `"icon-sm"`) wrapping an Icon, with shadcn's Tooltip attached directly
   * to the button itself (decisions/28) rather than through the generic
   * Tooltip.svelte wrapper — that wrapper attaches the trigger's hover/
   * focus wiring to a `display:contents` span AROUND its children, and
   * `focus`/`blur` don't bubble, so a real focusable trigger like this one
   * needs the wiring on its own element to still show the tooltip on
   * keyboard focus (see Tooltip.svelte's doc comment).
   *
   * The label is required and becomes both the accessible name and (unless
   * suppressed) the tooltip, so there is no way to ship an unlabelled icon
   * button from here — unchanged from the pre-migration version.
   *
   * `tone`/`variant` map onto Button's own variants rather than ad-hoc
   * colour overrides: `filled` + `primary` is Button's solid `default`
   * (the composer's send button), `filled` + `danger` is `destructive`
   * (the composer's stop button), `filled` + `default` is the tonal
   * `secondary` (Transcript's "Jump to latest"), and `plain` is always
   * `ghost` with the tone tinting the glyph only in its resting state —
   * `ghost`'s own hover state already swaps to the neutral foreground
   * colour, matching the old CSS's hover rule beating the tone rule on
   * specificity.
   */
  import Icon from "./Icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { cn } from "$lib/utils";
  import type { IconName } from "../../ui/icons";

  interface Props {
    icon: IconName;
    /** Accessible name, and the tooltip text unless `tooltip` is false. */
    label: string;
    onclick?: (event: MouseEvent) => void;
    disabled?: boolean;
    /** Set false for buttons whose meaning is already obvious in context. */
    tooltip?: boolean;
    tooltipPlacement?: "top" | "bottom";
    /** Tints the glyph — used for the accent send button and destructive actions. */
    tone?: "default" | "primary" | "danger";
    /** Renders a filled container instead of a bare glyph (the send button). */
    variant?: "plain" | "filled";
    /**
     * "compact" shrinks the hit target alone, 36px -> 32px, for secondary
     * actions sitting inline with body text — e.g. the per-reply copy/
     * regenerate row. The glyph itself stays the scale's one `glyph` role
     * (16px, decisions/36-type-and-icon-scale.md) either way: Button forces
     * every icon inside it to `size-4` regardless of the button's own size
     * variant, so there never was a second, smaller glyph size to have.
     */
    size?: "default" | "compact";
    title?: string;
  }

  const {
    icon,
    label,
    onclick,
    disabled = false,
    tooltip = true,
    tooltipPlacement = "top",
    tone = "default",
    variant = "plain",
    size = "default",
    title,
  }: Props = $props();

  const buttonVariant = $derived(
    variant === "filled"
      ? tone === "primary"
        ? "default"
        : tone === "danger"
          ? "destructive"
          : "secondary"
      : "ghost",
  );

  const toneClass = $derived(
    variant === "plain" && tone === "primary"
      ? "text-primary"
      : variant === "plain" && tone === "danger"
        ? "text-destructive"
        : "",
  );

  const buttonSize = $derived(size === "compact" ? "icon-sm" : "icon");
  const titleAttr = $derived(title ?? (tooltip ? undefined : label));
</script>

{#snippet glyph()}
  <Icon name={icon} />
{/snippet}

{#if tooltip && !disabled}
  <Tooltip.Provider>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            type="button"
            variant={buttonVariant}
            size={buttonSize}
            class={cn("rounded-full", toneClass)}
            aria-label={label}
            title={titleAttr}
            {disabled}
            {onclick}
          >
            {@render glyph()}
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side={tooltipPlacement}>
        {label}
      </Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>
{:else}
  <Button
    type="button"
    variant={buttonVariant}
    size={buttonSize}
    class={cn("rounded-full", toneClass)}
    aria-label={label}
    title={titleAttr}
    {disabled}
    {onclick}
  >
    {@render glyph()}
  </Button>
{/if}

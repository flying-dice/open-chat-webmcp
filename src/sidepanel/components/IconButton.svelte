<script lang="ts">
  /**
   * A circular icon button: a 24px glyph centred in a 40px hit target, with
   * a Material state layer on hover/press.
   *
   * The label is required and becomes both the accessible name and (unless
   * suppressed) the tooltip, so there is no way to ship an unlabelled icon
   * button from here.
   *
   * This resets background/border/border-radius/padding from the tonal
   * `button` rule in chat-theme.css. Svelte's scoping already outranks that
   * element selector, so no !important is involved.
   */
  import Icon from "./Icon.svelte";
  import Tooltip from "./Tooltip.svelte";
  import type { IconName } from "../../lib/icons";

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
     * "compact" shrinks the hit target and glyph together (32px / 18px)
     * for secondary actions sitting inline with body text — e.g. the
     * per-reply copy/regenerate row — where the default 40px/24px pairing
     * reads as oversized against the surrounding content.
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
</script>

{#snippet control()}
  <button
    type="button"
    class="icon-button"
    data-tone={tone}
    data-variant={variant}
    data-size={size}
    aria-label={label}
    title={title ?? (tooltip ? undefined : label)}
    {disabled}
    {onclick}
  >
    <Icon name={icon} size={size === "compact" ? 18 : undefined} />
  </button>
{/snippet}

{#if tooltip && !disabled}
  <Tooltip {label} placement={tooltipPlacement}>
    {@render control()}
  </Tooltip>
{:else}
  {@render control()}
{/if}

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css and
     src/sidepanel/chat-theme.css. */
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--icon-button-size);
    height: var(--icon-button-size);
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-on-surface-variant);
    cursor: pointer;
    transition:
      background-color var(--transition-fast),
      color var(--transition-fast);
  }

  .icon-button:hover:not(:disabled) {
    background: var(--state-hover);
    color: var(--color-on-surface);
  }

  .icon-button:active:not(:disabled) {
    background: var(--state-pressed);
  }

  .icon-button:disabled {
    cursor: default;
    opacity: 0.38; /* M3 disabled content opacity */
  }

  .icon-button[data-size="compact"] {
    width: var(--icon-button-size-compact);
    height: var(--icon-button-size-compact);
  }

  .icon-button[data-tone="primary"] {
    color: var(--color-primary);
  }

  .icon-button[data-tone="danger"] {
    color: var(--color-danger);
  }

  /* The filled variant is the composer's send button: a squarer, tonal
     container rather than a bare glyph, so it reads as the primary action. */
  .icon-button[data-variant="filled"] {
    border-radius: var(--radius-card);
    background: var(--color-surface-container-high);
    color: var(--color-on-surface);
  }

  .icon-button[data-variant="filled"][data-tone="primary"] {
    color: var(--color-primary);
  }

  .icon-button[data-variant="filled"]:hover:not(:disabled) {
    background: var(--color-surface-container-highest);
  }
</style>

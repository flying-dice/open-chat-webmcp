<script lang="ts">
  /**
   * A single Material-grid glyph. Paths live in src/lib/icons.ts; this
   * component is only the SVG wrapper around them.
   *
   * The glyph is `fill: currentColor`, so callers set its colour by setting
   * `color` on the element (or letting it inherit) — no colour prop, and no
   * variant explosion for hover/disabled/danger states.
   *
   * `aria-hidden` is hardcoded: an icon is never the accessible name of
   * anything. IconButton carries the label; inline icons sit next to text
   * that already says what they mean.
   */
  import { ICON_VIEW_BOX, iconPaths, type IconName } from "../../lib/icons";

  interface Props {
    name: IconName;
    /** Rendered size in px. Defaults to the --icon-size token (24). */
    size?: number | string;
  }

  const { name, size }: Props = $props();

  const dimension = $derived(
    size === undefined ? "var(--icon-size)" : typeof size === "number" ? `${size}px` : size,
  );
</script>

<svg
  class="icon"
  viewBox={ICON_VIEW_BOX}
  style:width={dimension}
  style:height={dimension}
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
>
  <path d={iconPaths[name]} />
</svg>

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css and
     src/sidepanel/chat-theme.css. */
  .icon {
    display: block;
    flex: none;
  }
</style>

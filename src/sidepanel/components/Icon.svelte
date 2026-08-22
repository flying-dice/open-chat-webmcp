<script lang="ts">
  /**
   * A single glyph. Standard glyphs render as Hugeicons (Maia's icon
   * pairing, decisions/28-shadcn-svelte-maia-zinc.md); `sparkle` and
   * `ollama` — not stock Hugeicons glyphs — still render from the inline
   * path data in src/ui/icons.ts, exactly as before.
   *
   * The `name`-based prop API is unchanged from the pre-migration version
   * on purpose: Transcript.svelte, ActivityIndicator.svelte and
   * src/ui/providerIcon.ts all pass an `IconName` through here (or through
   * IconButton) and are out of this card's scope, so this stayed a drop-in
   * replacement rather than a new API every caller has to adopt.
   *
   * Hugeicons render with `fill: none` + `stroke: currentColor` (outline
   * icons); the two custom paths are solid marks (`fill: currentColor`) —
   * Icon.svelte just picks the right branch per name, callers never care.
   *
   * Sizing is CLASS-based only (decisions/36-type-and-icon-scale.md), not a
   * numeric `size` prop: `HugeiconsIcon` renders width/height as SVG
   * *presentation attributes*, which CSS always beats — including any
   * ancestor kit component's `[&_svg:not([class*='size-'])]:size-N` rule
   * (Button, Command.Item, DropdownMenu.Item, Empty.Media, Badge, Alert, …).
   * A numeric `size` prop was therefore a coin flip: authoritative inside a
   * bare span, silently overridden inside almost every kit component. A
   * literal `size-*` class on the glyph itself always wins — over both the
   * width/height attributes AND a forcing ancestor rule, since the class
   * makes the `:not([class*='size-'])` guard skip the icon entirely. Callers
   * pick a role off the icon scale: `size-4` (16px, `glyph` — the workhorse,
   * everything inside a button/menu item/tab/badge/chip/line of body text)
   * or `size-5` (20px, `mark` — identity glyphs and the empty-state icon).
   */
  import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/svelte";
  import {
    ArrowLeft01Icon,
    ArrowDown01Icon,
    ArrowUp01Icon,
    ArrowRight01Icon,
    Cancel01Icon,
    CheckmarkCircle02Icon,
    Compass01Icon,
    Copy01Icon,
    Delete02Icon,
    Diamond02Icon,
    FlashIcon,
    Globe02Icon,
    GridViewIcon,
    HexagonIcon,
    InformationCircleIcon,
    LinkSquare02Icon,
    MoreHorizontalIcon,
    MoreVerticalIcon,
    PencilEdit02Icon,
    Refresh01Icon,
    RoboticIcon,
    Route02Icon,
    Settings02Icon,
    StopIcon,
    TerminalIcon,
    TextAlignLeftIcon,
    Tick02Icon,
    UserGroupIcon,
    WindIcon,
    Wrench01Icon,
  } from "@hugeicons/core-free-icons";
  import { ICON_VIEW_BOX, iconPaths, type IconName, type StandardIconName } from "../../ui/icons";
  import { cn } from "$lib/utils";

  /** old Material Symbols name -> Hugeicons free icon (card 66's mapping). */
  const hugeicons: Record<StandardIconName, IconSvgElement> = {
    air: WindIcon,
    alt_route: Route02Icon,
    arrow_back: ArrowLeft01Icon,
    arrow_downward: ArrowDown01Icon,
    arrow_upward: ArrowUp01Icon,
    bolt: FlashIcon,
    build: Wrench01Icon,
    check: Tick02Icon,
    check_circle: CheckmarkCircle02Icon,
    chevron_right: ArrowRight01Icon,
    close: Cancel01Icon,
    content_copy: Copy01Icon,
    // TODO: clean-code - 0.5 - DEAD: this "delete" lookup entry is unreachable — name="delete" is never passed to <Icon> anywhere in src, and there's no dynamic iteration over this map that would reach it structurally (see src/ui/icons.ts's matching union member).
    delete: Delete02Icon,
    diamond: Diamond02Icon,
    edit_square: PencilEdit02Icon,
    expand_more: ArrowDown01Icon,
    explore: Compass01Icon,
    group: UserGroupIcon,
    hexagon: HexagonIcon,
    info: InformationCircleIcon,
    more_horiz: MoreHorizontalIcon,
    more_vert: MoreVerticalIcon,
    open_in_new: LinkSquare02Icon,
    public: Globe02Icon,
    refresh: Refresh01Icon,
    settings: Settings02Icon,
    smart_toy: RoboticIcon,
    stop: StopIcon,
    subject: TextAlignLeftIcon,
    terminal: TerminalIcon,
    widgets: GridViewIcon,
  };

  interface Props {
    name: IconName;
    /**
     * A `size-*` Tailwind utility off the icon scale — `size-4` (16px,
     * `glyph`) or `size-5` (20px, `mark`); see the doc comment above.
     * Defaults to `size-4`, the workhorse role, for any call site that
     * doesn't need to say otherwise.
     */
    class?: string;
  }

  const { name, class: className = "size-4" }: Props = $props();

  const isCustom = $derived(name === "sparkle" || name === "ollama");
  /**
   * `arrow_back` is the one glyph in this map whose meaning IS "toward the
   * start of reading order" — every call site uses it for browser-back-style
   * navigation (`App.svelte`'s "back to chat" row), never for a fixed
   * screen direction — so it is unconditionally mirrored under `dir="rtl"`
   * here rather than left to each caller (card 104's RTL icon audit).
   * `chevron_right`'s other directional uses are handled at their own call
   * sites instead, because some of them combine it with a `rotate-90` on
   * expand/collapse and mirroring would fight that rotation.
   */
  const isDirectional = $derived(name === "arrow_back");
  const svgClass = $derived(cn("block shrink-0", isDirectional && "rtl:-scale-x-100", className));
</script>

{#if isCustom}
  <svg
    class={svgClass}
    viewBox={ICON_VIEW_BOX}
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path d={iconPaths[name as "sparkle" | "ollama"]} />
  </svg>
{:else}
  <HugeiconsIcon
    icon={hugeicons[name as StandardIconName]}
    strokeWidth={2}
    class={svgClass}
    aria-hidden="true"
    focusable="false"
  />
{/if}

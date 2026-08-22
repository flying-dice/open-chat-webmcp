<script lang="ts">
  /**
   * A single glyph. Standard glyphs render as Hugeicons (Maia's icon
   * pairing, decisions/28-shadcn-svelte-maia-zinc.md); `sparkle` and
   * `ollama` — not stock Hugeicons glyphs — still render from the inline
   * path data in src/lib/icons.ts, exactly as before.
   *
   * The `name`-based prop API is unchanged from the pre-migration version
   * on purpose: Transcript.svelte, ActivityIndicator.svelte and
   * src/lib/providers/presets.ts all pass an `IconName` through here (or
   * through IconButton) and are out of this card's scope, so this stayed a
   * drop-in replacement rather than a new API every caller has to adopt.
   *
   * Hugeicons render with `fill: none` + `stroke: currentColor` (outline
   * icons); the two custom paths are solid marks (`fill: currentColor`) —
   * Icon.svelte just picks the right branch per name, callers never care.
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
  import { ICON_VIEW_BOX, iconPaths, type IconName, type StandardIconName } from "../../lib/icons";

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
    /** Rendered size in px. Defaults to 24. */
    size?: number | string;
  }

  const { name, size }: Props = $props();

  const isCustom = $derived(name === "sparkle" || name === "ollama");
  const dimension = $derived(size === undefined ? 24 : size);
</script>

{#if isCustom}
  <svg
    class="block shrink-0"
    viewBox={ICON_VIEW_BOX}
    style:width={typeof dimension === "number" ? `${dimension}px` : dimension}
    style:height={typeof dimension === "number" ? `${dimension}px` : dimension}
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path d={iconPaths[name as "sparkle" | "ollama"]} />
  </svg>
{:else}
  <HugeiconsIcon
    icon={hugeicons[name as StandardIconName]}
    size={dimension}
    strokeWidth={2}
    class="block shrink-0"
    aria-hidden="true"
    focusable="false"
  />
{/if}

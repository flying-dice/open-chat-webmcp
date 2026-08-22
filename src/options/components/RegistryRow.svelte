<script lang="ts">
  // The row shell both options-page registries render (card 113). ProviderRow
  // and McpServerRow each used to spell out the same four pieces of markup by
  // hand — the bordered wrapper, the move-up/move-down button pair, the
  // masked-custom-header count, and the "Permission needed"/"Permission
  // granted" badge pair — which is what their paired 0.4 DRY markers named.
  // Those are not two registries' worth of decisions; they are one list-row
  // vocabulary the two lists deliberately share (see McpServersSection's
  // header: "the same kind of section, one field shape different").
  //
  // What DOES differ stays with the caller, as snippets: the middle badges
  // (a provider's backend/default pair vs a server's disabled/bearer/
  // reconnect trio), the action buttons, and whatever the row shows underneath
  // (a test result, a blocked-default reason). decisions/20's caution — an
  // edit to one registry must never silently change the other — is why this
  // shell holds no branch about WHICH registry it is rendering: every
  // registry-specific decision is made by the caller and handed in.
  //
  // Card 71 (decisions/28-shadcn-svelte-maia-zinc.md) chose these exact
  // treatments: a bordered div rather than a `Card` (the row nests inside the
  // section's own card, and a card-in-card reads as two elevations for one
  // thing), and shadcn `Badge`/`Button` throughout. Every control keeps the
  // accessible name its caller gives it — the verify harness locates them by
  // name (decisions/28's consequences), which is why the two aria-labels are
  // required props rather than something derived here.
  import type { Snippet } from "svelte";
  import { m } from "../../paraglide/messages.js";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";

  interface Props {
    /** The row's title line — the config's display name. */
    name: string;
    /** The second line, always LTR: a provider's base URL or a server's endpoint URL. */
    url: string;
    isFirst: boolean;
    isLast: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    /** Accessible names for the reorder pair — each registry names its own subject ("Move Ollama up"), and the verify harness finds the buttons by them. */
    moveUpLabel: string;
    moveDownLabel: string;
    /** `undefined` while the grant check is still in flight, distinct from a settled `true`/`false` — the badge never briefly flashes "needed". */
    permissionGranted: boolean | undefined;
    /** How many custom headers this config carries; `0` renders nothing. Values are never shown (decisions/15 — they are credentials), only counted. */
    headerCount: number;
    /**
     * Marks the row as inactive — a disabled MCP server. Providers have no
     * such state.
     *
     * CARD 115: this used to be `opacity-60` over the whole row, which axe
     * caught as a serious `color-contrast` failure on the endpoint URL and
     * the permission badge — 60% opacity multiplies down every colour
     * underneath it, so a disabled server's URL (the very thing you read
     * before deciding to re-enable it) fell below 4.5:1. It was also saying
     * the same thing twice: McpServerRow already renders an explicit
     * "Disabled" badge right there. A muted fill marks the row instead, and
     * the badge does the talking.
     */
    dimmed?: boolean;
    /** Registry-specific badges, rendered between the title and the shared header-count/permission pair. */
    badges?: Snippet;
    /** The row's right-aligned action buttons. */
    actions: Snippet;
    /** Anything below the header line — a test result, a blocked-default reason. */
    children?: Snippet;
  }

  let {
    name,
    url,
    isFirst,
    isLast,
    onMoveUp,
    onMoveDown,
    moveUpLabel,
    moveDownLabel,
    permissionGranted,
    headerCount,
    dimmed = false,
    badges,
    actions,
    children,
  }: Props = $props();
</script>

<div class="flex flex-col gap-2 rounded-2xl border p-3" class:bg-muted={dimmed}>
  <div class="flex flex-wrap items-center gap-2">
    <div class="flex flex-col gap-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        onclick={onMoveUp}
        disabled={isFirst}
        aria-label={moveUpLabel}
      >
        <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onclick={onMoveDown}
        disabled={isLast}
        aria-label={moveDownLabel}
      >
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
      </Button>
    </div>

    <div class="min-w-0">
      <div class="text-sm font-medium">{name}</div>
      <div class="text-xs break-all text-muted-foreground" dir="ltr">{url}</div>
    </div>

    {@render badges?.()}

    {#if headerCount > 0}
      <span class="text-xs text-muted-foreground" title={m.headerValuesMaskedTitle()}>
        {m.customHeaderCountLabel({ count: headerCount })}
      </span>
    {/if}
    {#if permissionGranted === false}
      <Badge variant="destructive" title={m.permissionNeededTitle()}>
        {m.permissionNeededBadge()}
      </Badge>
    {:else if permissionGranted === true}
      <Badge variant="outline" title={m.permissionGrantedTitle()}>{m.permissionGrantedBadge()}</Badge>
    {/if}

    <div class="ms-auto flex flex-wrap items-center gap-1">
      {@render actions()}
    </div>
  </div>

  {@render children?.()}
</div>

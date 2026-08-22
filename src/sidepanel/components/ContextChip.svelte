<script lang="ts">
  /**
   * The page-context strip directly above the composer (decisions/18,
   * re-skinned by decisions/28): which tab this chat is attached to,
   * whether we're connected, and how many WebMCP tools that page publishes.
   *
   * All three used to occupy two rows of the header. They belong here
   * instead, because all three describe what will happen when you press
   * Send — and the reference panel puts exactly this information in exactly
   * this place ("Sharing 'New Tab'").
   *
   * Deliberately NOT copied from the reference: its dismiss "X". That
   * button detaches the shared tab. We have no detach concept — tools are
   * attached per turn by App.svelte based on the model's capability — so an
   * X here would look like it stopped sharing the page while page tools
   * carried on being offered to the model. Instead the whole strip is a
   * button that opens the tool inspector, which is what someone poking at
   * "6 tools" actually wants.
   *
   * This component is only ever mounted directly above Composer.svelte in
   * App.svelte's composer dock, so its bottom corners are hard-coded square
   * rather than negotiated with a sibling selector — see App.svelte's dock
   * markup, which stacks the two with no gap so this chip's rounded top and
   * the composer's rounded bottom read as one unit.
   */
  import Icon from "./Icon.svelte";
  import { cn } from "$lib/utils";
  import { isolateLtr } from "../../ui/bidi";
  import type { ConnectionStatus, PageInfo } from "../stores/panel.svelte";
  import { connectionStatusLabel } from "../presentation/connectionStatus";
  import { m } from "../../paraglide/messages.js";

  interface Props {
    pageInfo: PageInfo | undefined;
    connectionStatus: ConnectionStatus;
    /** Opens the tools & call log view. */
    onOpenTools?: () => void;
  }

  const { pageInfo, connectionStatus, onOpenTools }: Props = $props();

  // The origin is a URL — always LTR — interpolated straight into a
  // translated sentence with no DOM element boundary around just that
  // part, so it gets Unicode-isolated rather than `dir="ltr"` (card 104's
  // RTL bidi-isolation pass; `pageInfo.title` is left alone since a page's
  // own title is natural-language text in whatever direction it is).
  const label = $derived.by((): string => {
    if (!pageInfo) return m.contextChip_noActiveTab();
    if (pageInfo.restricted)
      return m.contextChip_cantReadOrigin({ origin: isolateLtr(pageInfo.origin) });
    return m.contextChip_sharing({ title: pageInfo.title || isolateLtr(pageInfo.origin) });
  });

  const toolCountLabel = $derived.by((): string | undefined => {
    if (!pageInfo || pageInfo.restricted) return undefined;
    return m.contextChip_toolCount({ count: pageInfo.toolCount });
  });

  /** The full story, for the tooltip and the accessible name — the strip itself only has room for the headline. */
  const detail = $derived.by((): string => {
    const parts = [label, connectionStatusLabel(connectionStatus)];
    if (toolCountLabel) parts.push(toolCountLabel);
    if (pageInfo?.restricted) {
      parts.push(m.contextChip_restrictedDetail());
    }
    return parts.join(" · ");
  });

  let iconFailed = $state(false);

  // A tab's favicon URL can 404 or be blocked; when it does, fall back to
  // the globe rather than leaving a broken-image box in the chrome.
  $effect(() => {
    void pageInfo?.favIconUrl;
    iconFailed = false;
  });

  const dotColor: Record<ConnectionStatus, string> = {
    unknown: "bg-muted-foreground",
    connecting: "bg-primary",
    connected: "bg-emerald-500 dark:bg-emerald-400",
    disconnected: "bg-muted-foreground",
    error: "bg-destructive",
  };
</script>

{#snippet body()}
  <span class="relative inline-flex size-4 flex-none items-center justify-center">
    {#if pageInfo?.favIconUrl && !iconFailed}
      <img
        src={pageInfo.favIconUrl}
        alt=""
        class="size-4 rounded-sm"
        onerror={() => (iconFailed = true)}
      />
    {:else}
      <Icon name="public" class="size-4" />
    {/if}
    <!-- Connection state rides on the favicon rather than taking its own
         row: it is a property of the thing the row is already about. -->
    <span
      class={cn(
        "absolute -end-0.5 -bottom-0.5 size-1.5 rounded-full ring-2 ring-secondary transition-colors",
        dotColor[connectionStatus],
      )}
      aria-hidden="true"
    ></span>
  </span>

  <span class="min-w-0 flex-1 truncate">{label}</span>

  {#if toolCountLabel}
    <span class="flex-none whitespace-nowrap max-[360px]:hidden">{toolCountLabel}</span>
  {/if}
{/snippet}

<!-- A button only when there is somewhere to go. Rendering a disabled or
     inert button when `onOpenTools` is absent would put a control in the
     tab order that does nothing. -->
{#if onOpenTools}
  <button
    type="button"
    class="flex w-full min-w-0 items-center gap-2 rounded-t-2xl rounded-b-none bg-secondary px-3 py-2 text-start text-sm text-muted-foreground hover:bg-muted"
    onclick={onOpenTools}
    title={detail}
    aria-label={m.contextChip_openToolsAriaLabel({ detail })}
  >
    {@render body()}
    <!-- Static forward-hint chevron (opens the tool inspector) — genuinely
         directional, no competing rotate transform, so it flips outright
         under RTL (card 104's icon audit). -->
    <span class="flex-none"><Icon name="chevron_right" class="size-4 rtl:-scale-x-100" /></span>
  </button>
{:else}
  <div
    class="flex w-full min-w-0 items-center gap-2 rounded-t-2xl rounded-b-none bg-secondary px-3 py-2 text-start text-sm text-muted-foreground"
    title={detail}
  >
    {@render body()}
  </div>
{/if}

<script lang="ts">
  /**
   * The page-context strip directly above the composer (decisions/18,
   * re-skinned by decisions/28): which tab this chat is attached to,
   * whether we're connected, how many WebMCP tools that page publishes —
   * and, since card 119, whether the assistant may see that page at all.
   *
   * All of it belongs here because all of it describes what will happen when
   * you press Send, and the reference panel puts exactly this information in
   * exactly this place ("Sharing 'New Tab'").
   *
   * ── THE DISMISS "X" IS BACK, AND IT MEANS SOMETHING NOW ─────────────────
   *
   * This component used to carry a comment explaining why the reference's
   * dismiss button was deliberately NOT copied: we had no detach concept, so
   * an X would have looked like it stopped sharing the page while page tools
   * carried on being offered to the model. decisions/40 (as revised) removes
   * that objection by making the state real — the X now dismisses a SHARING
   * GATE (src/sidepanel/stores/pageSharing.svelte.ts) that the tools panel,
   * the tool count here, the turn's tool attachment and every page-context
   * pull all obey. The chip is the whole of that control:
   *
   *   SHARING (default)  "Sharing <page> · N tools", the strip opens the tool
   *                      inspector, a "Share page content" toggle sits beside
   *                      it with a visible on/off state, and the ✕ dismisses.
   *   NOT SHARING        "Not sharing this page", nothing about tools, and an
   *                      equally prominent "Share this page" button —
   *                      decisions/40 asks for re-enabling to be as visible as
   *                      dismissing was, so this is a labelled button rather
   *                      than a second icon the user has to guess at.
   *   RESTRICTED         exactly as before (decisions/40: "restricted pages
   *                      behave as today"). No gate is offered, because there
   *                      is nothing there to share or to withhold — Chrome has
   *                      already made that decision.
   *
   * This component is only ever mounted directly above Composer.svelte in
   * App.svelte's composer dock, so its bottom corners are hard-coded square
   * rather than negotiated with a sibling selector — see App.svelte's dock
   * markup, which stacks the two with no gap so this chip's rounded top and
   * the composer's rounded bottom read as one unit.
   */
  import { tick } from "svelte";
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
    /** decisions/40's sharing gate for the page on screen — `false` once the user has dismissed it. */
    sharing: boolean;
    /** Whether the page's own text goes with the next message. Only meaningful while `sharing`. */
    shareContent: boolean;
    /** The ✕ and the "Share this page" button. */
    onSetSharing: (on: boolean) => void;
    /** The "Share page content" toggle. */
    onSetShareContent: (on: boolean) => void;
  }

  const {
    pageInfo,
    connectionStatus,
    onOpenTools,
    sharing,
    shareContent,
    onSetSharing,
    onSetShareContent,
  }: Props = $props();

  /**
   * Chrome's own refusal, checked before the user's: a restricted page keeps
   * exactly today's chip, with no gate controls at all. Offering a "stop
   * sharing" button for a page nothing can be read from would be a control
   * that does nothing, and offering "share page content" would be an outright
   * false promise.
   */
  const restricted = $derived(pageInfo?.restricted === true);

  /** True only where the gate is a real choice: a resolved, non-restricted page. */
  const gateable = $derived(pageInfo !== undefined && !restricted);

  // The origin is a URL — always LTR — interpolated straight into a
  // translated sentence with no DOM element boundary around just that
  // part, so it gets Unicode-isolated rather than `dir="ltr"` (card 104's
  // RTL bidi-isolation pass; `pageInfo.title` is left alone since a page's
  // own title is natural-language text in whatever direction it is).
  const label = $derived.by((): string => {
    if (!pageInfo) return m.contextChip_noActiveTab();
    if (restricted) return m.contextChip_cantReadOrigin({ origin: isolateLtr(pageInfo.origin) });
    if (!sharing) return m.contextChip_notSharing();
    return m.contextChip_sharing({ title: pageInfo.title || isolateLtr(pageInfo.origin) });
  });

  /**
   * Hidden while the gate is down — decisions/40 requires the count itself to
   * go, not just the tool list: "6 tools" next to "not sharing" would be the
   * panel telling the user about a page it has just promised to be blind to.
   */
  const toolCountLabel = $derived.by((): string | undefined => {
    if (!pageInfo || restricted || !sharing) return undefined;
    return m.contextChip_toolCount({ count: pageInfo.toolCount });
  });

  /** The full story, for the tooltip and the accessible name — the strip itself only has room for the headline. */
  const detail = $derived.by((): string => {
    const parts = [label, connectionStatusLabel(connectionStatus)];
    if (toolCountLabel) parts.push(toolCountLabel);
    if (restricted) parts.push(m.contextChip_restrictedDetail());
    if (gateable && !sharing) parts.push(m.contextChip_notSharingDetail());
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

  /**
   * A button only when there is somewhere to go AND something to say about
   * tools. With the gate down the strip stops being a doorway to the tool
   * inspector: the tools it would show are exactly the ones the user has just
   * hidden.
   */
  const opensTools = $derived(onOpenTools !== undefined && sharing);

  /**
   * CARD 115 — THE GATE HANDS FOCUS OVER TO ITS OWN REPLACEMENT.
   *
   * Dismissing sharing unmounts the ✕ that was just pressed and mounts "Share
   * this page" in its place; re-enabling does the exact reverse. Either way
   * the pressed button ceases to exist, and the audit confirmed Chrome then
   * drops focus to `<body>` — a keyboard user loses their place in the strip
   * entirely, and a screen-reader user hears nothing about a state they
   * deliberately changed.
   *
   * Moving focus to the button that replaced it fixes both at once: the new
   * button's own label ("Share this page" / "Stop sharing this page") states
   * the state that now holds, which is how a toggle is supposed to announce
   * itself — no live region needed, and none added, because a live region
   * here would say the same sentence a second time.
   */
  let stopButton = $state<HTMLButtonElement | null>(null);
  let shareAgainButton = $state<HTMLButtonElement | null>(null);

  function toggleSharing(on: boolean): void {
    onSetSharing(on);
    void tick().then(() => (on ? stopButton : shareAgainButton)?.focus());
  }
</script>

{#snippet body()}
  <span class="relative inline-flex size-4 flex-none items-center justify-center">
    {#if pageInfo?.favIconUrl && !iconFailed && sharing}
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

<div
  class="flex w-full min-w-0 items-center gap-1 rounded-t-2xl rounded-b-none bg-secondary py-1 pe-1 ps-1 text-sm text-muted-foreground"
  data-sharing={gateable ? sharing : undefined}
>
  <!-- A button only when there is somewhere to go. Rendering a disabled or
       inert button when there is no destination would put a control in the
       tab order that does nothing. -->
  {#if opensTools && onOpenTools}
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-2 rounded-full px-2 py-1 text-start hover:bg-muted"
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
    <div class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-start" title={detail}>
      {@render body()}
    </div>
  {/if}

  {#if gateable && sharing && shareContent}
    <!-- The share-page-content TOGGLE lives in the kebab menu now — showing
         it here whenever sharing was on made the default chip row read as
         two controls deep before the user had asked for anything (Jonathan,
         2026-08-23). What remains here is decisions/40's visible STANDING
         STATE: this pill exists only while page content is opted in, and
         clicking it opts back out. -->
    <button
      type="button"
      aria-pressed="true"
      aria-label={m.contextChip_shareContentLabel()}
      title={m.contextChip_shareContentHint()}
      class="flex flex-none items-center gap-1 rounded-full bg-background px-2 py-1 text-xs text-foreground ring-1 ring-border"
      onclick={() => onSetShareContent(false)}
    >
      <Icon name="subject" class="size-4" />
      <span class="max-[360px]:hidden">{m.contextChip_shareContentLabel()}</span>
    </button>
  {/if}

  {#if gateable && sharing}
    <button
      bind:this={stopButton}
      type="button"
      aria-label={m.contextChip_stopSharingLabel()}
      title={m.contextChip_stopSharingLabel()}
      class="flex-none rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      onclick={() => toggleSharing(false)}
    >
      <Icon name="close" class="size-4" />
    </button>
  {:else if gateable}
    <!-- The re-enable affordance, deliberately a LABELLED button and not a
         mirrored icon: decisions/40 asks for it to be as visible as the
         dismiss was, and an unlabelled glyph in a strip that now reads "Not
         sharing this page" would be the least discoverable thing on screen. -->
    <button
      bind:this={shareAgainButton}
      type="button"
      class="flex-none rounded-full bg-background px-3 py-1 text-xs font-medium text-foreground ring-1 ring-border hover:bg-muted"
      onclick={() => toggleSharing(true)}
    >
      {m.contextChip_shareAgainLabel()}
    </button>
  {/if}
</div>

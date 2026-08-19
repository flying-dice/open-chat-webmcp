<script lang="ts">
  /**
   * The page-context strip directly above the composer (decisions/18):
   * which tab this chat is attached to, whether we're connected, and how
   * many WebMCP tools that page publishes.
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
   */
  import Icon from "./Icon.svelte";
  import type { ConnectionStatus, PageInfo } from "../stores/panel.svelte";

  interface Props {
    pageInfo: PageInfo | undefined;
    connectionStatus: ConnectionStatus;
    /** Opens the tools & call log view. */
    onOpenTools?: () => void;
  }

  const { pageInfo, connectionStatus, onOpenTools }: Props = $props();

  const statusLabel: Record<ConnectionStatus, string> = {
    unknown: "Not connected",
    connecting: "Connecting…",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Connection error",
  };

  const label = $derived.by((): string => {
    if (!pageInfo) return "No active tab";
    if (pageInfo.restrictedReason) return `Can't read ${pageInfo.origin}`;
    return `Sharing '${pageInfo.title || pageInfo.origin}'`;
  });

  const toolCountLabel = $derived.by((): string | undefined => {
    if (!pageInfo || pageInfo.restrictedReason) return undefined;
    return `${pageInfo.toolCount} ${pageInfo.toolCount === 1 ? "tool" : "tools"}`;
  });

  /** The full story, for the tooltip and the accessible name — the strip itself only has room for the headline. */
  const detail = $derived.by((): string => {
    const parts = [label, statusLabel[connectionStatus]];
    if (toolCountLabel) parts.push(toolCountLabel);
    if (pageInfo?.restrictedReason) parts.push(pageInfo.restrictedReason);
    return parts.join(" · ");
  });

  let iconFailed = $state(false);

  // A tab's favicon URL can 404 or be blocked; when it does, fall back to
  // the globe rather than leaving a broken-image box in the chrome.
  $effect(() => {
    void pageInfo?.favIconUrl;
    iconFailed = false;
  });
</script>

{#snippet body()}
  <span class="favicon" data-status={connectionStatus}>
    {#if pageInfo?.favIconUrl && !iconFailed}
      <img src={pageInfo.favIconUrl} alt="" onerror={() => (iconFailed = true)} />
    {:else}
      <Icon name="public" size={16} />
    {/if}
    <!-- Connection state rides on the favicon rather than taking its own
         row: it is a property of the thing the row is already about. -->
    <span class="status-dot" aria-hidden="true"></span>
  </span>

  <span class="label">{label}</span>

  {#if toolCountLabel}
    <span class="tool-count">{toolCountLabel}</span>
  {/if}
{/snippet}

<!-- A button only when there is somewhere to go. Rendering a disabled or
     inert button when `onOpenTools` is absent would put a control in the
     tab order that does nothing. -->
{#if onOpenTools}
  <button
    type="button"
    class="context-chip"
    onclick={onOpenTools}
    title={detail}
    aria-label={`${detail}. Open tools and call log`}
  >
    {@render body()}
    <span class="chevron" aria-hidden="true"><Icon name="chevron_right" size={18} /></span>
  </button>
{:else}
  <div class="context-chip" title={detail}>
    {@render body()}
  </div>
{/if}

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css and
     src/sidepanel/chat-theme.css (decisions/18). */

  .context-chip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: calc(100% - var(--space-3) * 2);
    margin: 0 var(--space-3);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    border: none;
    /* Rounded on top only, and sitting flush on the composer below it, so
       the two read as one attached unit rather than two stacked bars. */
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--color-surface-container);
    color: var(--color-on-surface-variant);
    font-size: var(--font-size-small);
    text-align: left;
    min-width: 0;
    flex: none;
  }

  .context-chip:hover {
    background: var(--color-surface-container-high);
  }

  .favicon {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 16px;
    height: 16px;
  }

  .favicon img {
    width: 16px;
    height: 16px;
    border-radius: var(--radius-sm);
  }

  .status-dot {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 7px;
    height: 7px;
    border-radius: var(--radius-full);
    background: var(--color-on-surface-variant);
    /* Ringed in the chip's own background so the dot stays legible against
       whatever the favicon happens to be. */
    box-shadow: 0 0 0 2px var(--color-surface-container);
    transition: background-color var(--transition-fast);
  }

  .context-chip:hover .status-dot {
    box-shadow: 0 0 0 2px var(--color-surface-container-high);
  }

  .favicon[data-status="connected"] .status-dot {
    background: var(--color-success);
  }

  .favicon[data-status="connecting"] .status-dot {
    background: var(--color-primary);
  }

  .favicon[data-status="error"] .status-dot {
    background: var(--color-danger);
  }

  .label {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tool-count {
    flex: none;
    white-space: nowrap;
  }

  /* Below roughly 360px the title has nothing left to give — drop the count
     rather than ellipsizing the one part of the row that names the page. */
  @media (max-width: 360px) {
    .tool-count {
      display: none;
    }
  }

  .chevron {
    display: inline-flex;
    flex: none;
  }
</style>

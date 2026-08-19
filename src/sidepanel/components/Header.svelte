<script lang="ts">
  /**
   * Panel header: current-page indicator, connection status, and the SLOT
   * card 23 (decisions/11-provider-capability-detection.md) mounts its
   * provider/model picker into.
   *
   * HEADER SLOT CONTRACT for card 23:
   *   Pass a `picker` snippet prop, e.g.:
   *
   *     <Header {pageInfo} {connectionStatus}>
   *       {#snippet picker()}
   *         <ProviderPicker />
   *       {/snippet}
   *     </Header>
   *
   *   It renders inline in the header's right-hand cluster, next to the
   *   connection dot. It should be a single compact control (native
   *   <select>/<button> per decisions/08) that degrades gracefully at
   *   ~320px — give it `min-width: 0` and let long labels ellipsis rather
   *   than forcing the header to grow. Until card 23 passes one, a plain
   *   placeholder chip renders in its place so the layout is already
   *   correct to build against.
   */
  import type { Snippet } from "svelte";
  import type { ConnectionStatus, PageInfo } from "../stores/panel.svelte";

  interface Props {
    pageInfo: PageInfo | undefined;
    connectionStatus: ConnectionStatus;
    picker?: Snippet;
    /**
     * Card 36 (boards/project-backlog/36-new-chat-action.md): retires the
     * current chat to history and starts a fresh one, keeping the
     * provider/model selection. Omitted entirely (button doesn't render)
     * until App.svelte passes a handler, mirroring how `picker` degrades.
     */
    onNewChat?: () => void;
    /** True while there's no page to start a fresh chat against, or a reply is currently streaming (swapping the live session mid-stream would silently orphan it — see App.svelte's `handleNewChat`). */
    newChatDisabled?: boolean;
  }

  let { pageInfo, connectionStatus, picker, onNewChat, newChatDisabled }: Props = $props();

  const statusLabel: Record<ConnectionStatus, string> = {
    unknown: "Not connected",
    connecting: "Connecting…",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Connection error",
  };
</script>

<header>
  <div class="page-row">
    <div class="page-info" title={pageInfo ? `${pageInfo.title} — ${pageInfo.origin}` : undefined}>
      <span class="page-title">{pageInfo?.title || "No active tab"}</span>
      {#if pageInfo?.origin}
        <span class="page-origin">{pageInfo.origin}</span>
      {/if}
    </div>
    {#if pageInfo}
      <span class="tool-count" title="Tools available on this page">
        {pageInfo.toolCount} {pageInfo.toolCount === 1 ? "tool" : "tools"}
      </span>
    {/if}
    {#if onNewChat}
      <button
        type="button"
        class="new-chat-btn"
        onclick={onNewChat}
        disabled={newChatDisabled}
        title="Start a new chat — keeps your provider/model selection, previous chat stays in History"
      >
        New chat
      </button>
    {/if}
  </div>

  <div class="control-row">
    <span class="connection" data-status={connectionStatus} title={statusLabel[connectionStatus]}>
      <span class="dot" aria-hidden="true"></span>
      {statusLabel[connectionStatus]}
    </span>

    <div class="picker-slot">
      {#if picker}
        {@render picker()}
      {:else}
        <span class="picker-placeholder">Provider — (card 23)</span>
      {/if}
    </div>
  </div>
</header>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-outline);
    background: var(--color-surface-container);
  }

  .page-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .page-info {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
  }

  .page-title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .page-origin {
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex-shrink: 1;
  }

  .tool-count {
    flex: 0 0 auto;
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
    background: var(--color-surface-container-high);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-1);
    white-space: nowrap;
  }

  .control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }

  .connection {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-on-surface-variant);
    transition: background-color var(--transition-fast);
  }

  .connection[data-status="connected"] .dot {
    background: #1e8e3e; /* approximation: Chrome's own "on" green, used sparingly per decisions/08 */
  }

  .connection[data-status="connecting"] .dot {
    background: var(--color-primary);
  }

  .connection[data-status="error"] .dot {
    background: var(--color-danger);
  }

  .new-chat-btn {
    flex: 0 0 auto;
    font-size: var(--font-size-small);
    padding: var(--space-1) var(--space-2);
    white-space: nowrap;
  }

  .picker-slot {
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    justify-content: flex-end;
  }

  .picker-placeholder {
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
    border: 1px dashed var(--color-outline);
    border-radius: var(--radius-pill);
    padding: var(--space-1) var(--space-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
  }
</style>

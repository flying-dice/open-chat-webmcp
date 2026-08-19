<script lang="ts">
  /**
   * The header's kebab overflow menu (decisions/18): recent chats, the tool
   * inspector, and settings, in one anchored dropdown.
   *
   * This replaces the Chat / Tools & Log / History segmented control that
   * used to eat a whole row under the header. At 320px a permanent tab
   * strip costs more than it earns — you are in the chat almost always, and
   * the other two views are somewhere you visit, not somewhere you switch
   * between.
   *
   * Submenus replace the menu's contents IN PLACE behind a "Back" row
   * rather than flying out sideways, because there is no sideways in a
   * 320px panel.
   *
   * Recent chats are re-listed every time the menu opens rather than kept
   * live: `listChatSummaries` reads `chat:index` only (no message bodies),
   * and a menu that is closed has nothing to keep fresh.
   */
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";
  import { listChatSummaries, type ChatSummary } from "../../lib/session";
  import { openChatInTab, panel, type ConnectionStatus } from "../stores/panel.svelte";
  import { openOptionsPage } from "../stores/selection.svelte";
  import { titleFromSummary } from "../lib/chatTitle";

  interface Props {
    /** Open the full history view. */
    onOpenHistory: () => void;
    /** Open the tools & call log view. */
    onOpenTools: () => void;
    connectionStatus: ConnectionStatus;
  }

  const { onOpenHistory, onOpenTools, connectionStatus }: Props = $props();

  /** How many chats the top level lists before deferring to "More". Five is what fits above the divider without the menu needing to scroll at a typical panel height. */
  const RECENT_LIMIT = 5;

  let open = $state(false);
  let level = $state<"root" | "settings">("root");
  let summaries = $state<ChatSummary[]>([]);
  let rootEl: HTMLDivElement | undefined = $state();

  const statusLabel: Record<ConnectionStatus, string> = {
    unknown: "Not connected",
    connecting: "Connecting…",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Connection error",
  };

  const recent = $derived(summaries.slice(0, RECENT_LIMIT));
  const hasMore = $derived(summaries.length > RECENT_LIMIT);

  function toggle(): void {
    open = !open;
    if (open) {
      // Always reopen at the root: a menu that remembers it was left in a
      // submenu makes the kebab unpredictable.
      level = "root";
      void listChatSummaries().then((s) => (summaries = s));
    }
  }

  function close(): void {
    open = false;
  }

  // Same dismissal contract as ProviderPicker's sheet: pointerdown outside
  // (captured, so it beats anything that stops propagation) or Escape.
  $effect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootEl && e.target instanceof Node && !rootEl.contains(e.target)) close();
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeydown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeydown);
    };
  });

  function run(action: () => void): void {
    close();
    action();
  }

  async function handleOpenChat(id: string): Promise<void> {
    close();
    await openChatInTab(id);
  }
</script>

<div class="menu-root" bind:this={rootEl}>
  <IconButton
    icon="more_vert"
    label="More options"
    onclick={toggle}
    tooltipPlacement="bottom"
  />

  {#if open}
    <div class="menu" role="menu" aria-label="Panel menu">
      {#if level === "root"}
        <p class="menu-label">Recent chats</p>

        {#if recent.length === 0}
          <p class="menu-empty">No chats yet.</p>
        {:else}
          {#each recent as summary (summary.id)}
            <button
              type="button"
              role="menuitem"
              class="menu-row"
              data-active={summary.id === panel.activeChatId}
              onclick={() => void handleOpenChat(summary.id)}
            >
              <Icon name="subject" size={20} />
              <span class="menu-row__label">{titleFromSummary(summary)}</span>
            </button>
          {/each}
        {/if}

        {#if hasMore || recent.length > 0}
          <button type="button" role="menuitem" class="menu-row" onclick={() => run(onOpenHistory)}>
            <Icon name="more_horiz" size={20} />
            <span class="menu-row__label">More</span>
            <Icon name="chevron_right" size={20} />
          </button>
        {/if}

        <hr />

        <button type="button" role="menuitem" class="menu-row" onclick={() => run(onOpenTools)}>
          <Icon name="build" size={20} />
          <span class="menu-row__label">Tools &amp; call log</span>
        </button>

        <button type="button" role="menuitem" class="menu-row" onclick={() => (level = "settings")}>
          <Icon name="settings" size={20} />
          <span class="menu-row__label">Settings and help</span>
          <Icon name="chevron_right" size={20} />
        </button>
      {:else}
        <button type="button" class="menu-row" onclick={() => (level = "root")}>
          <Icon name="arrow_back" size={20} />
          <span class="menu-row__label">Back</span>
        </button>

        <button type="button" role="menuitem" class="menu-row" onclick={() => run(openOptionsPage)}>
          <Icon name="settings" size={20} />
          <span class="menu-row__label">Open options</span>
          <Icon name="open_in_new" size={20} />
        </button>

        <!-- Not a control: the connection state has no action attached to
             it, it is just the one place in the menu you can read it. -->
        <p class="menu-status">
          <Icon name="info" size={20} />
          <span class="menu-row__label">{statusLabel[connectionStatus]}</span>
        </p>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css and
     src/sidepanel/chat-theme.css (decisions/18). */

  .menu-root {
    position: relative;
    flex: none;
  }

  .menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    right: 0;
    z-index: 20;
    /* Must fit a 320px panel: the nominal width, or whatever the viewport
       leaves, whichever is smaller. */
    width: min(var(--menu-width), calc(100vw - var(--space-4)));
    max-height: calc(100vh - 96px);
    overflow-y: auto;
    /* Clips the full-bleed active row to the menu's radius — without this
       the highlighted row's square corners poke out. */
    overflow-x: hidden;
    padding: var(--space-2) 0;
    border-radius: var(--radius-lg);
    background: var(--color-surface-container);
    box-shadow: var(--elevation-2);
  }

  .menu-label {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
  }

  .menu-empty {
    margin: 0;
    padding: var(--space-2) var(--space-4) var(--space-3);
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
  }

  .menu-row,
  .menu-status {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    margin: 0;
    min-height: var(--menu-row-height);
    padding: 0 var(--space-4);
    /* Full-bleed rows: the highlight runs edge to edge like Chrome's own
       menus, so it resets the tonal button styling entirely. */
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--color-on-surface);
    font-size: var(--font-size-body);
    text-align: left;
  }

  .menu-status {
    color: var(--color-on-surface-variant);
  }

  .menu-row:hover {
    background: var(--state-hover);
  }

  .menu-row:active {
    background: var(--state-pressed);
  }

  .menu-row[data-active="true"] {
    background: var(--color-secondary-container);
    color: var(--color-on-secondary-container);
  }

  .menu-row__label {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  hr {
    margin: var(--space-2) 0;
    border-top-color: var(--color-outline-variant);
  }
</style>

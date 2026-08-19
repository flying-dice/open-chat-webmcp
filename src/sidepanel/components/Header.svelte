<script lang="ts">
  /**
   * Panel header (decisions/18): one row, flush with the page background,
   * no divider — the conversation title on the left, icon actions on the
   * right, exactly the silhouette Chrome's own Gemini panel uses.
   *
   * Everything this header used to carry has moved:
   *   - the page indicator and tool count → ContextChip, above the composer
   *   - the connection dot                → ContextChip, on the favicon
   *   - the provider/model picker         → the composer's action row
   * A chat panel's header should say which chat you are in, not restate the
   * page you are on; the page belongs next to the box you type into,
   * because that is where it affects what happens.
   *
   * Deliberately NOT copied from the reference: its picture-in-picture and
   * close buttons. There is no chrome.sidePanel.close() API and no document
   * PiP path worth faking here, and Chrome already draws its own close
   * control above ours — a button that sometimes does nothing is worse than
   * no button.
   */
  import type { Snippet } from "svelte";
  import IconButton from "./IconButton.svelte";

  interface Props {
    /** The conversation title, or the name of the view currently open. */
    title: string;
    /**
     * Card 36: retires the current chat to history and starts a fresh one,
     * keeping the provider/model selection.
     */
    onNewChat?: () => void;
    /** True while there's no page to start a fresh chat against, or a reply is currently streaming (swapping the live session mid-stream would silently orphan it — see App.svelte's `handleNewChat`). */
    newChatDisabled?: boolean;
    /**
     * The kebab overflow menu (recent chats, tools & call log, settings).
     * Rendered as a snippet because the menu owns its own open state and
     * anchoring — the header only decides where in the row it sits.
     */
    menu?: Snippet;
  }

  let { title, onNewChat, newChatDisabled, menu }: Props = $props();
</script>

<header>
  <h1 class="chat-title" {title}>{title}</h1>

  <div class="actions">
    {#if onNewChat}
      <IconButton
        icon="edit_square"
        label="New chat"
        onclick={onNewChat}
        disabled={newChatDisabled}
        tooltipPlacement="bottom"
      />
    {/if}
    {#if menu}
      {@render menu()}
    {/if}
  </div>
</header>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css and
     src/sidepanel/chat-theme.css (decisions/18). */

  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    /* Vertical padding is small because the 40px icon buttons already set
       the row height; this only stops the title touching the panel edge. */
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
    /* No border and no container colour: the header is part of the same
       surface as the transcript, not a bar sitting on top of it. */
    background: var(--color-surface);
    flex: none;
  }

  .chat-title {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    /* Regular weight, secondary colour: the title labels the panel, it
       isn't the loudest thing in it. The messages are. */
    font-size: var(--font-size-heading);
    font-weight: 400;
    line-height: var(--line-height-heading);
    color: var(--color-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .actions {
    display: flex;
    align-items: center;
    /* No gap: 40px targets around 24px glyphs already carry their own
       optical spacing, and closing it up keeps the cluster from pushing the
       title into an ellipsis at 320px. */
    flex: none;
  }
</style>

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
    /**
     * Card 56 (decisions/24-explicit-chat-titles.md): renames the active
     * chat. Its mere presence is what makes the title editable — this
     * header is shared by all three views (chat/inspector/history) and is
     * handed the VIEW's name when not in chat, so editing must be opt-in
     * per render from App.svelte, never inferred from `title` itself.
     */
    onRename?: (title: string) => void;
  }

  let { title, onNewChat, newChatDisabled, menu, onRename }: Props = $props();

  /** Whether the title is currently the in-place edit control. Reset to `false` whenever the caller stops passing `onRename` (e.g. a view switch away from chat while mid-edit). */
  let editing = $state(false);
  let draft = $state("");
  let inputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (!onRename && editing) editing = false;
  });

  $effect(() => {
    if (editing) inputEl?.focus();
  });

  function startEditing(): void {
    if (!onRename) return;
    draft = title;
    editing = true;
  }

  /** Enter or blur — decision 24's "save" path. A no-op if already committed/cancelled (guards a stray blur that fires after Escape already closed the input). */
  function commit(): void {
    if (!editing) return;
    editing = false;
    onRename?.(draft);
  }

  /** Escape — decision 24's "cancel and restore the previous value". Since this never calls `onRename`, the parent's `title` (and therefore what's shown once editing ends) is simply whatever it already was. */
  function cancel(): void {
    editing = false;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }
</script>

<header>
  <h1 class="chat-title">
    {#if editing}
      <input
        bind:this={inputEl}
        bind:value={draft}
        class="chat-title-input"
        type="text"
        aria-label="Chat name"
        maxlength="120"
        onkeydown={handleKeydown}
        onblur={commit}
      />
    {:else if onRename}
      <button
        type="button"
        class="chat-title-button"
        onclick={startEditing}
        title={title}
        aria-label={`${title} (click to rename)`}
      >
        {title}
      </button>
    {:else}
      <span class="chat-title-text" {title}>{title}</span>
    {/if}
  </h1>

  <div class="actions">
    {#if onNewChat}
      <IconButton
        icon="edit_square"
        label="New chat"
        size="compact"
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
    /* Vertical padding is small because the compact 32px icon buttons
       already set the row height; this only stops the title touching the
       panel edge. */
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
       isn't the loudest thing in it. The messages are. Set here (not on the
       child text/button/input) so all three variants share one definition
       and none of them can drift the header's row height. */
    font-size: var(--font-size-heading);
    font-weight: 400;
    line-height: var(--line-height-heading);
    color: var(--color-on-surface-variant);
  }

  .chat-title-text {
    display: block;
    padding: 1px var(--space-1);
    border: 1px solid transparent;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The static (non-editable) look, reset from the global `button` rule in
     src/lib/theme.css (pill, bordered, its own background) so an editable
     title looks exactly like the plain heading until interacted with — no
     extra chrome hints editability beyond the pointer cursor and hover
     tint, matching how other inline-editable text in Material Expressive UI
     behaves. Border stays `none`/`transparent` at every state (never added
     on hover/focus) so it can never change the header's height — the
     platform focus ring (outline, see theme.css) is the only focus
     indicator, and it draws outside the box without taking layout space. */
  .chat-title-button,
  .chat-title-input {
    display: block;
    width: 100%;
    min-width: 0;
    margin: 0;
    padding: 1px var(--space-1);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    font: inherit;
    color: inherit;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chat-title-button {
    cursor: pointer;
  }

  .chat-title-button:hover {
    background: var(--state-hover);
  }

  .chat-title-input {
    /* A visible (but non-reflowing) box while editing, so the control reads
       as "currently a text field" beyond just the caret. */
    border-color: var(--color-outline);
    background: var(--color-surface);
    cursor: text;
  }

  .actions {
    display: flex;
    align-items: center;
    /* No gap: the compact 32px targets around 18px glyphs already carry
       their own optical spacing, and closing it up keeps the cluster from
       pushing the title into an ellipsis at 320px. */
    flex: none;
  }
</style>

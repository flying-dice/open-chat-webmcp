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
  import { m } from "../../paraglide/messages.js";

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
    onRename?: ((title: string) => void) | undefined;
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

<header class="flex flex-none items-center gap-2 py-2 pr-2 pl-4">
  <h1 class="m-0 min-w-0 flex-1 text-sm font-medium text-foreground">
    {#if editing}
      <input
        bind:this={inputEl}
        bind:value={draft}
        class="block w-full min-w-0 rounded-md border border-input bg-background px-1 py-px font-sans text-sm text-foreground"
        type="text"
        aria-label={m.header_chatNameAriaLabel()}
        maxlength="120"
        onkeydown={handleKeydown}
        onblur={commit}
      />
    {:else if onRename}
      <button
        type="button"
        class="block w-full min-w-0 truncate rounded-md border border-transparent px-1 py-px text-left hover:bg-accent hover:text-accent-foreground"
        onclick={startEditing}
        title={title}
        aria-label={m.header_renameAriaLabel({ title })}
      >
        {title}
      </button>
    {:else}
      <span class="block truncate px-1 py-px" {title}>{title}</span>
    {/if}
  </h1>

  <div class="flex flex-none items-center">
    {#if onNewChat}
      <IconButton
        icon="edit_square"
        label={m.header_newChatLabel()}
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

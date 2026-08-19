<script lang="ts">
  /**
   * The row of actions under a finished assistant reply (decisions/18).
   *
   * Only two icons, against the reference's five: copy and regenerate.
   * Thumbs up/down are deliberately absent — nothing in this extension
   * consumes a rating, and a control that silently discards the click is
   * worse than no control at all.
   *
   * The copy button copies the RAW markdown, not the rendered text: what
   * the model wrote is what a user pasting into a document or an issue
   * almost always wants, and Markdown.svelte's per-code-block copy button
   * already covers "just the code".
   */
  import IconButton from "./IconButton.svelte";
  import Tooltip from "./Tooltip.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    /** The raw markdown of the reply this row belongs to. */
    content: string;
    /**
     * Resend the last user turn. Passed only for the LAST assistant message
     * — regenerating anything earlier would append a reply at the bottom
     * that appears to answer a message far above it.
     */
    onRegenerate?: () => void;
  }

  const { content, onRegenerate }: Props = $props();

  let copied = $state(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  // Same 1.5s confirmation window as the code-block copy button in
  // src/lib/components/Markdown.svelte, so the two feel like one gesture.
  const COPIED_RESET_MS = 1500;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => (copied = false), COPIED_RESET_MS);
    } catch {
      // Clipboard access can be refused (no user gesture, permissions
      // policy). Staying silent is right: the button simply doesn't
      // confirm, and nothing about the conversation is broken.
    }
  }

  $effect(() => () => clearTimeout(resetTimer));
</script>

<div class="message-actions-row">
  {#if copied}
    <!-- Swapped rather than restyled: the check IS the confirmation, and
         its tooltip changes with it so a screen reader hears it too. -->
    <Tooltip label="Copied">
      <span class="copied-badge" role="status">
        <Icon name="check" />
      </span>
    </Tooltip>
  {:else}
    <IconButton icon="content_copy" label="Copy response" onclick={copy} />
  {/if}

  {#if onRegenerate}
    <IconButton icon="refresh" label="Regenerate" onclick={onRegenerate} />
  {/if}
</div>

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css and
     src/sidepanel/chat-theme.css (decisions/18). */

  .message-actions-row {
    display: flex;
    align-items: center;
    /* Pulled left so the 40px targets' own padding lines the glyphs up with
       the message text above them rather than indenting them. */
    margin-left: calc(var(--space-2) * -1);
  }

  /* Matches IconButton's geometry so the row doesn't jump when the copy
     button swaps to its confirmation. */
  .copied-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--icon-button-size);
    height: var(--icon-button-size);
    color: var(--color-primary);
  }
</style>

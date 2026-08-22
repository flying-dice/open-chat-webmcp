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
   *
   * Card 67 (decisions/28-shadcn-svelte-maia-zinc.md): scoped CSS replaced
   * with Tailwind utilities; IconButton/Tooltip are already shadcn-backed.
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
  // src/ui/components/Markdown.svelte, so the two feel like one gesture.
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

<!-- -ml-2 pulls the 32px compact targets' own padding back in line with the
     message text above them rather than indenting the row. -->
<div class="-ml-2 flex items-center">
  {#if copied}
    <!-- Swapped rather than restyled: the check IS the confirmation, and
         its tooltip changes with it so a screen reader hears it too. Sized
         to match IconButton's compact geometry (size-8 = 32px) so the row
         doesn't jump when the copy button swaps to this. -->
    <Tooltip label="Copied">
      <span role="status" class="inline-flex size-8 items-center justify-center text-primary">
        <Icon name="check" class="size-4" />
      </span>
    </Tooltip>
  {:else}
    <IconButton icon="content_copy" label="Copy response" size="compact" onclick={copy} />
  {/if}

  {#if onRegenerate}
    <IconButton icon="refresh" label="Regenerate" size="compact" onclick={onRegenerate} />
  {/if}
</div>

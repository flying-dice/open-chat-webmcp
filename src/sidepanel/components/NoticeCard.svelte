<script lang="ts">
  /**
   * The transcript's notice card (decisions/18): a filled, rounded block of
   * secondary text, optionally dismissible — the shape Chrome's Gemini panel
   * uses for its "conversations aren't used to train models" notice.
   *
   * These replace the full-width banner strips that used to sit under the
   * header. A notice about the page or the chat belongs IN the conversation,
   * where it is read once and scrolls away, rather than permanently eating a
   * row of a 320px-wide panel.
   *
   * Deliberately calm: container background, secondary text, no danger
   * colour. Every notice we show is an expected configuration state (a
   * restricted page, a chat opened against a different origin), not an
   * error, and colouring it red would teach the user to ignore red.
   */
  import type { Snippet } from "svelte";
  import IconButton from "./IconButton.svelte";

  interface Props {
    children: Snippet;
    /**
     * Provide only for notices that are an announcement — something the
     * user reads once and is done with. A notice that reflects LIVE state
     * (e.g. "this page can't be read") must not be dismissible: it has to
     * come back when the state comes back, and a close button on it would
     * be a lie.
     */
    onDismiss?: () => void;
    dismissLabel?: string;
  }

  const { children, onDismiss, dismissLabel = "Dismiss" }: Props = $props();
</script>

<div class="notice">
  <div class="notice-body">{@render children()}</div>
  {#if onDismiss}
    <IconButton icon="close" label={dismissLabel} onclick={onDismiss} tooltipPlacement="bottom" />
  {/if}
</div>

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css and
     src/sidepanel/chat-theme.css (decisions/18). */

  .notice {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-4);
    /* Trailing padding is tighter when a close button sits there — the
       40px target supplies its own optical margin. */
    padding-right: var(--space-2);
    border-radius: var(--radius-lg);
    background: var(--color-surface-container);
    color: var(--color-on-surface-variant);
    font-size: var(--font-size-small);
  }

  .notice:not(:has(:global(button))) {
    padding-right: var(--space-4);
  }

  .notice-body {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .notice-body :global(p) {
    margin: 0;
  }

  .notice-body :global(p + p) {
    margin-top: var(--space-2);
  }

  .notice-body :global(strong) {
    color: var(--color-on-surface);
    font-weight: 500;
  }
</style>

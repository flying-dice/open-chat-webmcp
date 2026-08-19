<script lang="ts">
  /**
   * Multiline composer: Enter sends, Shift+Enter inserts a newline, and the
   * send button swaps for a stop button while a message is streaming
   * (card 07 checklist). Sending itself is a stub — it hands the typed text
   * to `onSend` and clears the textarea; wiring that to an actual model call
   * is the card 08/09 agent loop's job, not this shell's.
   */
  interface Props {
    streaming: boolean;
    onSend: (text: string) => void;
    onStop: () => void;
  }

  let { streaming, onSend, onStop }: Props = $props();

  let value = $state("");
  let textarea: HTMLTextAreaElement | undefined = $state();

  function send(): void {
    const text = value.trim();
    if (!text || streaming) return;
    onSend(text);
    value = "";
    textarea?.focus();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    // isComposing guards IME (e.g. typing Japanese/Chinese) committing its
    // candidate on Enter — that Enter must not also send the message.
    if (event.isComposing) return;
    event.preventDefault();
    send();
  }
</script>

<form class="composer" onsubmit={(e) => (e.preventDefault(), send())}>
  <textarea
    bind:this={textarea}
    bind:value
    onkeydown={handleKeydown}
    placeholder="Ask about this page… (Enter to send, Shift+Enter for a new line)"
    rows="1"
    disabled={streaming}
  ></textarea>

  {#if streaming}
    <button type="button" class="stop-button" onclick={onStop}> Stop </button>
  {:else}
    <button type="submit" disabled={!value.trim()}> Send </button>
  {/if}
</form>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .composer {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--color-outline);
    background: var(--color-surface);
  }

  textarea {
    flex: 1 1 auto;
    min-width: 0;
    max-height: 8lh;
    field-sizing: content;
  }

  button {
    flex: 0 0 auto;
  }

  .stop-button {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
</style>

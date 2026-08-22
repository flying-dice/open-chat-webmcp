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
   *
   * CARD 115 — THE CONFIRMATION NO LONGER REPLACES THE BUTTON. It used to
   * swap the copy button out for a `role="status"` badge for 1.5s, which
   * meant that copying WITH THE KEYBOARD unmounted the element that had
   * focus: the audit measured focus landing on `<body>`, so Tab restarted
   * from the top of the panel and Enter did nothing for a second and a half.
   * The button now stays mounted and changes its own glyph and accessible
   * name — which is also the better announcement, since a name change on the
   * focused element is spoken, where a live region appearing elsewhere in the
   * transcript competed with whatever else was being read.
   */
  import { copyText } from "../../ui/clipboard";
  import IconButton from "./IconButton.svelte";
  import { m } from "../../paraglide/messages.js";

  interface Props {
    /** The raw markdown of the reply this row belongs to. */
    content: string;
    /**
     * Resend the last user turn. Passed only for the LAST assistant message
     * — regenerating anything earlier would append a reply at the bottom
     * that appears to answer a message far above it.
     */
    onRegenerate?: (() => void) | undefined;
  }

  const { content, onRegenerate }: Props = $props();

  let copied = $state(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  // Same 1.5s confirmation window as the code-block copy button in
  // src/ui/components/Markdown.svelte, so the two feel like one gesture.
  const COPIED_RESET_MS = 1500;

  async function copy(): Promise<void> {
    // Card 95: through src/ui/clipboard.ts's never-throws wrapper. Staying
    // silent on a refusal is still right — the button simply doesn't confirm,
    // and nothing about the conversation is broken.
    if (!(await copyText(content))) return;
    copied = true;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => (copied = false), COPIED_RESET_MS);
  }

  $effect(() => () => clearTimeout(resetTimer));
</script>

<!-- -ml-2 pulls the 32px compact targets' own padding back in line with the
     message text above them rather than indenting the row. -->
<div class="-ml-2 flex items-center">
  <!-- One button throughout: the check glyph and the "Copied" name ARE the
       confirmation, and neither costs the user their focus (see the header). -->
  <IconButton
    icon={copied ? "check" : "content_copy"}
    label={copied ? m.copiedLabel() : m.messageActions_copyResponseLabel()}
    tone={copied ? "primary" : "default"}
    size="compact"
    onclick={copy}
  />

  {#if onRegenerate}
    <IconButton icon="refresh" label={m.messageActions_regenerateLabel()} size="compact" onclick={onRegenerate} />
  {/if}
</div>

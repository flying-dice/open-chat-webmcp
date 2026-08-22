<script lang="ts">
  /**
   * The transcript's notice card (decisions/18): a calm, dismissible-or-not
   * block of secondary text — the shape Chrome's Gemini panel uses for its
   * "conversations aren't used to train models" notice.
   *
   * These replace the full-width banner strips that used to sit under the
   * header. A notice about the page or the chat belongs IN the conversation,
   * where it is read once and scrolls away, rather than permanently eating a
   * row of a 320px-wide panel.
   *
   * Deliberately calm: the default (non-destructive) Alert variant, no
   * danger colour. Every notice we show is an expected configuration state
   * (a restricted page, a chat opened against a different origin), not an
   * error, and colouring it red would teach the user to ignore red.
   *
   * Card 67 (decisions/28-shadcn-svelte-maia-zinc.md): re-skinned onto
   * shadcn's Alert — `Alert.Action` is the primitive's own slot for exactly
   * this "optional trailing control" shape, and reserves its own padding
   * automatically (`has-data-[slot=alert-action]:pe-18`, logical since card
   * 108) so the tighter end padding when a dismiss button is present needs
   * no extra rule here, unlike the old hand-written `:not(:has(button))`
   * selector.
   */
  import type { Snippet } from "svelte";
  import IconButton from "./IconButton.svelte";
  import * as Alert from "$lib/components/ui/alert";
  import { m } from "../../paraglide/messages.js";

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
    /**
     * Card 95: `"failure"` for the one case the calm treatment above is
     * wrong for — something the USER JUST DID did not happen (a chat that
     * would not open, a name that did not save). Those arrive through
     * src/sidepanel/stores/notices.svelte.ts and are never live state, so
     * the rule the doc comment states still holds: red is reserved for a
     * failed action, never for a configuration fact, which is exactly what
     * stops it becoming the colour people learn to skip.
     */
    variant?: "notice" | "failure";
  }

  const {
    children,
    onDismiss,
    dismissLabel = m.noticeCard_dismissDefaultLabel(),
    variant = "notice",
  }: Props = $props();
</script>

<!-- `Alert.Root` sets `role="alert"` itself, for EVERY variant — i.e. an
     ASSERTIVE live region, which interrupts whatever a screen reader is
     currently saying. Card 115: that is right for `"failure"` (something the
     user just did did not happen — interrupting is the point) and wrong for
     the calm variant, which is exactly the doc comment above's distinction
     read back in ARIA terms. The restricted-page notice is rendered AT MOUNT
     and reflects standing state, so `role="alert"` had it barge in over the
     panel's own opening announcement every single time the user opened onto
     a chrome:// tab. `role="status"` is the polite equivalent: same
     announcement, waits its turn. It overrides Alert.Root's own attribute
     because `restProps` are spread after it. -->
<Alert.Root
  role={variant === "failure" ? "alert" : "status"}
  variant={variant === "failure" ? "destructive" : "default"}
>
  <Alert.Description
    class="text-sm [&_p:not(:last-child)]:mb-2 [&_strong]:font-medium [&_strong]:text-foreground {variant ===
    'failure'
      ? ''
      : 'text-muted-foreground'}"
  >
    {@render children()}
  </Alert.Description>
  {#if onDismiss}
    <Alert.Action>
      <IconButton icon="close" label={dismissLabel} tooltipPlacement="bottom" onclick={onDismiss} />
    </Alert.Action>
  {/if}
</Alert.Root>

<script lang="ts">
  /**
   * "Selected text" — the composer attachment for whatever the user has
   * highlighted on the page (card 119, decisions/40-page-context-access.md).
   *
   * Appears only while the sharing gate is on and the active tab actually has
   * a non-empty selection (src/sidepanel/stores/pageSharing.svelte.ts pulls it
   * at panel focus and again at send; an EMPTY selection is a successful pull
   * and produces no chip at all, per card 118). Dismissing it hides THAT
   * selection — highlight something else and a fresh chip appears — and
   * sending consumes it, the way an attachment goes with one message rather
   * than riding along with the rest of the conversation.
   *
   * ── BIDI ────────────────────────────────────────────────────────────────
   *
   * The excerpt is page-authored natural language: it can be Arabic inside an
   * English panel or English inside an Arabic one, and it is the ONE string
   * here whose direction is not ours to pick. It gets both halves of card
   * 104's toolkit, each where it belongs (src/ui/bidi.ts's own guidance):
   * `dir="auto"` on the element that holds it, so it takes its direction from
   * its own first strong character; and `isolateAuto` where it is
   * interpolated INTO an assembled message (the `title`), where there is no
   * element boundary to hang an attribute on and an unisolated run would drag
   * the sentence's punctuation to the wrong side.
   */
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";
  import { isolateAuto } from "../../ui/bidi";
  import { selectionExcerpt } from "../presentation/sharedContext";
  import { m } from "../../paraglide/messages.js";

  interface Props {
    /** The selection as pulled from the page — full text; this component previews it. */
    text: string;
    /** The ✕. */
    onDismiss: () => void;
  }

  const { text, onDismiss }: Props = $props();

  const excerpt = $derived(selectionExcerpt(text));
  const full = $derived(m.selectionChip_ariaLabel({ excerpt: isolateAuto(excerpt) }));
</script>

<div
  class="mb-1 flex w-full min-w-0 items-center gap-2 rounded-2xl border border-border bg-card px-3 py-1 text-sm"
  title={full}
>
  <Icon name="subject" class="size-4 flex-none text-muted-foreground" />
  <span class="flex-none text-xs font-medium text-foreground">{m.selectionChip_label()}</span>
  <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">{excerpt}</span>
  <IconButton
    icon="close"
    label={m.selectionChip_removeLabel()}
    size="compact"
    tooltip={false}
    onclick={onDismiss}
  />
</div>

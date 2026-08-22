<script lang="ts">
  /**
   * The transcript's record of what a user turn shared from the page (card
   * 119, decisions/40's "persisted transcript marker recording that context
   * was shared with that turn").
   *
   * Rendered under the user's own bubble, because that is what it is about:
   * this message went with the page's selected text, or with the page's
   * content, and the model saw it. It is the durable half of the visible
   * artifact decisions/40 requires — the chip says what is about to happen,
   * this says what did.
   *
   * LOCALIZED AT RENDER, from a stored KIND (decisions/38): what
   * `TranscriptEntry.sharedContext` holds is `{kind, truncated}`, never a
   * sentence, so history re-reads in whatever language the panel is in now.
   * The wording lives in src/sidepanel/presentation/sharedContext.ts with the
   * rest of this surface's code-to-copy mappings. Card 114 converts the OLDER
   * stored prose (assistant notes, tool statuses) to the same discipline;
   * nothing here needs to change when it does.
   */
  import type { SharedContextMarker } from "../../domain/chat";
  import { sharedContextLabel } from "../presentation/sharedContext";
  import { m } from "../../paraglide/messages.js";

  interface Props {
    /** Never empty — the caller renders nothing rather than an empty list. */
    markers: readonly SharedContextMarker[];
  }

  const { markers }: Props = $props();
</script>

<!-- Keyed by index: a marker carries no id, and the list is written once when
     the turn is sent and never mutated afterwards. -->
<ul
  aria-label={m.sharedContext_groupLabel()}
  class="m-0 flex list-none flex-wrap justify-end gap-1 p-0"
>
  {#each markers as marker, i (i)}
    <li class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {sharedContextLabel(marker)}
    </li>
  {/each}
</ul>

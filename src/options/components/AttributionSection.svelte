<script lang="ts">
  // Content attribution for the toolbar/store icon (icons/icon.svg, card 16
  // -extension-icons.md): sourced from Flaticon's "ECommerce | Flat" pack
  // (https://www.flaticon.com/packs/ecommerce-1340) by author sonnycandra
  // (https://www.flaticon.com/authors/sonnycandra). Flaticon's free license
  // requires this attribution to stay visible somewhere in the product
  // rather than just in a commit message, so it lives here rather than only
  // in the board card. Static content only — no settings, no state.
  //
  // Card 71: same `.section` shell as every other section, now a shadcn
  // `Card` (decisions/28-shadcn-svelte-maia-zinc.md). The licence text is
  // still rendered unconditionally — nothing here is collapsible or
  // conditional, because it has to stay visible.
  import * as Card from "$lib/components/ui/card";
  import { m } from "../../paraglide/messages.js";
</script>

<section aria-labelledby="attribution-heading">
  <Card.Root>
    <Card.Header>
      <h2 id="attribution-heading" class="text-base font-medium tracking-tight">
        {m.attributionSection_heading()}
      </h2>
      <Card.Description>{m.attributionSection_description()}</Card.Description>
    </Card.Header>

    <Card.Content>
      <!-- Flaticon's free licence requires this attribution to remain visible
           (see the header comment above) — the author username, pack name,
           and "Flaticon" itself are the required identifiers and are kept
           verbatim in every locale; only the connecting English words
           ("Icon by", "from the", "pack on") are translated. Fully
           developer-authored, no untrusted interpolation, so `{@html}` is
           safe here (card 101's technique 1). -->
      <p class="text-sm text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4">
        {@html m.attributionSection_credit()}
      </p>
    </Card.Content>
  </Card.Root>
</section>

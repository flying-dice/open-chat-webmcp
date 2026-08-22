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
</script>

<section aria-labelledby="attribution-heading">
  <Card.Root>
    <Card.Header>
      <h2 id="attribution-heading" class="text-base font-medium tracking-tight">Attribution</h2>
      <Card.Description>Third-party content used under its original license.</Card.Description>
    </Card.Header>

    <Card.Content>
      <p class="text-sm text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4">
        Icon by
        <a href="https://www.flaticon.com/authors/sonnycandra" target="_blank" rel="noopener noreferrer"
          >sonnycandra</a
        >
        from the
        <a href="https://www.flaticon.com/packs/ecommerce-1340" target="_blank" rel="noopener noreferrer"
          >ECommerce</a
        >
        pack on
        <a href="https://www.flaticon.com/" target="_blank" rel="noopener noreferrer">Flaticon</a>.
      </p>
    </Card.Content>
  </Card.Root>
</section>

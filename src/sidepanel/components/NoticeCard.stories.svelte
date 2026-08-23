<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). The transcript's calm notice card
   * plus card 95's "failure" variant, reserved for something the user just
   * DID not happening.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import NoticeCard from "./NoticeCard.svelte";

  const { Story } = defineMeta({
    title: "Side panel/NoticeCard",
    component: NoticeCard,
    tags: ["autodocs"],
  });
</script>

{#snippet restrictedBody()}
  This page can't be read by the extension, so tools and page content aren't available here.
{/snippet}

{#snippet dismissibleBody()}
  Conversations aren't used to train models.
{/snippet}

{#snippet failureBody()}
  The chat couldn't be renamed. Try again.
{/snippet}

<!-- `children` is NoticeCard's own required snippet prop, so it's passed by
     name rather than as tag content — spreading `args` AND slotting content
     between the tags leaves the compiler unable to tell which `children`
     wins. -->
<!-- Standing state — no dismiss button, since it has to come back the moment the state does. -->
<Story name="Restricted page (not dismissible)">
  {#snippet template(args)}
    <NoticeCard {...args} children={restrictedBody} />
  {/snippet}
</Story>

<!-- A read-once announcement — dismissible. -->
<Story name="Dismissible announcement" args={{ onDismiss: () => undefined }}>
  {#snippet template(args)}
    <NoticeCard {...args} children={dismissibleBody} />
  {/snippet}
</Story>

<!-- Card 95: something the user just did failed — the one case that gets the destructive treatment. -->
<Story name="Failure (assertive)" args={{ variant: "failure" }}>
  {#snippet template(args)}
    <NoticeCard {...args} children={failureBody} />
  {/snippet}
</Story>

<script module lang="ts">
  /**
   * Proof story 2 of card 123 (decisions/42-storybook.md): an OPTIONS-page
   * form in a specific validation STATE.
   *
   * HeadersEditor takes no services at all — its whole behaviour is the rows
   * it is given and the owning form's reserved-name rule (a prop). That makes
   * it the right second proof: it shows a story driving a component through
   * pure props and a `description` SNIPPET, which is the Svelte-5 shape the
   * CSF addon's `template` snippet exists for.
   *
   * The reserved-name error is the state worth looking at — decision 15's
   * "refused visibly at edit time, not dropped silently at request time" — and
   * it is also RTL-sensitive, since the row is an input pair with a trailing
   * remove button: flip the locale toolbar to العربية and the whole row has to
   * mirror.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import HeadersEditor from "./HeadersEditor.svelte";
  import type { HeaderRow, ReservedHeaderCheck } from "../forms/headerRows";
  import { reservedHeaderReason } from "../../domain/providers";
  import { providerReservedHeaderMessage } from "../../ui/reservedHeaderMessage";

  /**
   * ProviderForm's own rule (ProviderForm.svelte:180), with its live auth
   * state pinned to "an API key is configured" — the domain function and the
   * localized copy are both the real ones, so this story shows the sentence a
   * user actually gets rather than a story-shaped approximation of it.
   */
  const isReserved: ReservedHeaderCheck = (key) => {
    const reason = reservedHeaderReason(key, { type: "openai", apiKeyConfigured: true });
    return reason ? providerReservedHeaderMessage(reason) : undefined;
  };

  const CLEAN_ROWS: HeaderRow[] = [
    { id: 0, key: "X-Tenant", value: "acme" },
    { id: 1, key: "X-Trace", value: "storybook" },
  ];

  const RESERVED_ROWS: HeaderRow[] = [
    { id: 0, key: "X-Tenant", value: "acme" },
    { id: 1, key: "Authorization", value: "Bearer sk-not-a-real-key" },
  ];

  const { Story } = defineMeta({
    title: "Options/HeadersEditor",
    component: HeadersEditor,
    tags: ["autodocs"],
    args: { firstInputId: "story-header-name", isReserved, rows: CLEAN_ROWS },
  });
</script>

{#snippet description()}
  Sent with every request this provider makes.
{/snippet}

<Story name="Two clean rows">
  {#snippet template(args)}
    <HeadersEditor {...args} {description} />
  {/snippet}
</Story>

<!-- The row the guard exists for: a header the provider's own auth already owns. -->
<Story name="Reserved name" args={{ rows: RESERVED_ROWS }}>
  {#snippet template(args)}
    <HeadersEditor {...args} {description} />
  {/snippet}
</Story>

<!-- No rows yet — just the explanation and the Add button. -->
<Story name="Empty" args={{ rows: [] }}>
  {#snippet template(args)}
    <HeadersEditor {...args} {description} />
  {/snippet}
</Story>

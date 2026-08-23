<script module lang="ts">
  /**
   * Card 125 (decisions/42-storybook.md). The shared list-row shell both
   * registries render (card 113) — pure props and two snippets (`badges`,
   * `actions`), no services. Stories exercise the shell's own states
   * (permission badge, header count, dimmed/disabled) with plain stand-in
   * badges/actions, since the real per-registry badges are covered by
   * ProviderRow's and McpServerRow's own stories.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import RegistryRow from "./RegistryRow.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";

  const { Story } = defineMeta({
    title: "Options/RegistryRow",
    component: RegistryRow,
    tags: ["autodocs"],
    args: {
      name: "Example Row",
      url: "https://example.com",
      isFirst: false,
      isLast: false,
      onMoveUp: () => undefined,
      onMoveDown: () => undefined,
      moveUpLabel: "Move Example Row up",
      moveDownLabel: "Move Example Row down",
      permissionGranted: undefined,
      headerCount: 0,
    },
  });
</script>

{#snippet actions()}
  <Button variant="outline" size="sm">Test connection</Button>
  <Button variant="outline" size="sm">Edit</Button>
  <Button variant="outline" size="sm">Remove</Button>
{/snippet}

{#snippet badges()}
  <Badge variant="outline">Custom</Badge>
{/snippet}

<Story name="Default">
  {#snippet template(args)}
    <RegistryRow {...args} {actions} {badges} />
  {/snippet}
</Story>

<Story name="Permission needed" args={{ permissionGranted: false }}>
  {#snippet template(args)}
    <RegistryRow {...args} {actions} {badges} />
  {/snippet}
</Story>

<Story name="Permission granted" args={{ permissionGranted: true, headerCount: 2 }}>
  {#snippet template(args)}
    <RegistryRow {...args} {actions} {badges} />
  {/snippet}
</Story>

<Story name="Dimmed (disabled)" args={{ dimmed: true }}>
  {#snippet template(args)}
    <RegistryRow {...args} {actions} {badges} />
  {/snippet}
</Story>

<Story name="First and last (reorder disabled)" args={{ isFirst: true, isLast: true }}>
  {#snippet template(args)}
    <RegistryRow {...args} {actions} {badges} />
  {/snippet}
</Story>

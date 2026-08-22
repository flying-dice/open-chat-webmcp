<script lang="ts">
  /**
   * A generic tab-strip switch, now shadcn's Tabs (decisions/28) standing
   * in for the old hand-rolled pill strip. Used twice: the chat/inspector
   * switch in App.svelte, and the Tools/Call Log switch inside
   * Inspector.svelte. Still deliberately not tied to either — a bare
   * `{value, label}` list plus a callback — since it only ever drives an
   * external view switch and never renders `Tabs.Content` itself, the
   * caller stays in charge of what's actually shown for the active value.
   */
  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    options: Option[];
    value: string;
    onSelect: (value: string) => void;
    ariaLabel: string;
  }

  import * as Tabs from "$lib/components/ui/tabs";

  const { options, value, onSelect, ariaLabel }: Props = $props();
</script>

<Tabs.Root {value} onValueChange={onSelect} class="w-full">
  <Tabs.List aria-label={ariaLabel} class="w-full">
    {#each options as opt (opt.value)}
      <Tabs.Trigger value={opt.value} class="flex-1">{opt.label}</Tabs.Trigger>
    {/each}
  </Tabs.List>
</Tabs.Root>

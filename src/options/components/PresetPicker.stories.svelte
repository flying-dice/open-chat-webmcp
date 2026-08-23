<script module lang="ts">
  /**
   * Card 125 (decisions/42-storybook.md). Purely presentational — `onChoose`/
   * `onCancel` hand a chosen preset (or `undefined` for Custom) straight back
   * to the caller, so this needs no services at all. One story is enough to
   * show every tile: the catalogue itself (src/domain/providers/presets.ts)
   * is what varies, not this component's behaviour.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import PresetPicker from "./PresetPicker.svelte";

  const { Story } = defineMeta({
    title: "Options/PresetPicker",
    component: PresetPicker,
    tags: ["autodocs"],
    args: { onChoose: () => undefined, onCancel: () => undefined },
  });
</script>

<Story name="Choose a backend" />

<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). Card 119's "selected text"
   * composer attachment. RTL-sensitive by construction (see the component's
   * own header): the excerpt is page-authored natural language, not ours to
   * pick a direction for, so it carries `dir="auto"` — this story's second
   * case (an Arabic excerpt sitting inside an English-locale panel) is
   * exactly the case that attribute exists for, and was spot-checked live at
   * ar + 320px (see this card's journal on
   * boards/project-backlog/124-storybook-sidepanel-coverage.md).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import SelectionChip from "./SelectionChip.svelte";

  const { Story } = defineMeta({
    title: "Side panel/SelectionChip",
    component: SelectionChip,
    tags: ["autodocs"],
    parameters: { panelWidth: 400 },
    args: {
      text: "Chrome extensions send an Origin header that Ollama rejects by default.",
      onDismiss: () => undefined,
    },
  });
</script>

<Story name="English excerpt" />

<!-- An Arabic selection, e.g. highlighted on an Arabic-language page, previewed inside an English-locale panel — `dir="auto"` takes it from its own first strong character regardless of the panel's own direction. -->
<Story
  name="RTL excerpt (Arabic selection)"
  args={{ text: "تشير هذه الفقرة إلى أن المتصفح يرسل ترويسة Origin التي يرفضها Ollama افتراضيًا." }}
/>

<Story name="At 320px" parameters={{ panelWidth: 320 }} />

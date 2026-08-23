<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). Panel header — title, new-chat
   * action, and the rename-in-place control (decisions/24), gated on
   * `onRename` being passed at all.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Header from "./Header.svelte";

  const { Story } = defineMeta({
    title: "Side panel/Header",
    component: Header,
    tags: ["autodocs"],
    parameters: { panelWidth: 400 },
    args: { title: "Byzantine timeline", onNewChat: () => undefined },
  });
</script>

<Story name="Chat view (renamable)" args={{ onRename: () => undefined }} />

<Story name="Non-chat view (Tools & Call Log)" args={{ title: "Tools & Call Log", onRename: undefined }} />

<Story name="New chat disabled" args={{ newChatDisabled: true, onRename: () => undefined }} />

<Story name="At 320px" parameters={{ panelWidth: 320 }} args={{ onRename: () => undefined }} />

<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). The live status line at the tail
   * of the transcript while a turn is in flight (card 61, decisions/26) —
   * only ever `waiting`/`calling`, never `streaming`/`awaiting-approval`
   * (see the component's own header for why).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ActivityIndicator from "./ActivityIndicator.svelte";
  import type { SpokenPhase } from "../presentation/turnStatus";

  const WAITING: SpokenPhase = { kind: "waiting" };
  const CALLING_PAGE: SpokenPhase = {
    kind: "calling",
    toolName: "read_page_text",
    origin: { kind: "page" },
    startedAt: Date.now() - 2500,
  };
  const CALLING_SERVER: SpokenPhase = {
    kind: "calling",
    toolName: "acme__run_query",
    origin: { kind: "server", serverId: "acme", serverName: "Acme" },
    startedAt: Date.now() - 6000,
  };

  const { Story } = defineMeta({
    title: "Side panel/ActivityIndicator",
    component: ActivityIndicator,
    tags: ["autodocs"],
    args: { phase: WAITING, modelLabel: "llama3.1" },
  });
</script>

<Story name="Waiting for the model" />

<Story name="Calling a page tool" args={{ phase: CALLING_PAGE }} />

<Story name="Calling a server tool" args={{ phase: CALLING_SERVER }} />

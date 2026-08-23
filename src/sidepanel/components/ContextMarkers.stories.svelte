<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). Card 119's transcript record of
   * what a user turn shared from the page — localized AT RENDER from a
   * stored KIND (decisions/38), never stored prose, so this is a fair story:
   * whatever the locale toolbar is set to is exactly what a re-opened chat
   * would show.
   *
   * RTL-sensitive: the list is `justify-end` (card 104's bidi pass) so the
   * markers hug the trailing edge under the right-aligned user bubble in
   * both directions — spot-checked live at ar + 320px (see this card's
   * journal on boards/project-backlog/124-storybook-sidepanel-coverage.md).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ContextMarkers from "./ContextMarkers.svelte";
  import type { SharedContextMarker } from "../../domain/chat";

  const SELECTION_ONLY: SharedContextMarker[] = [{ kind: "page-selection", truncated: false }];

  const BOTH_TRUNCATED: SharedContextMarker[] = [
    { kind: "page-selection", truncated: false },
    { kind: "page-content", truncated: true },
  ];

  const { Story } = defineMeta({
    title: "Side panel/ContextMarkers",
    component: ContextMarkers,
    tags: ["autodocs"],
    args: { markers: SELECTION_ONLY },
  });
</script>

<Story name="Selection shared" />

<Story name="Selection + shortened page content" args={{ markers: BOTH_TRUNCATED }} />

<Story name="At 320px" parameters={{ panelWidth: 320 }} />

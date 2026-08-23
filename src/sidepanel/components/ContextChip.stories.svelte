<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). The page-context strip above the
   * composer — decisions/40's sharing gate, entirely prop-driven (no store
   * reads at all: `pageInfo`/`connectionStatus` are passed in by App.svelte
   * in production, and the two type imports here are types only).
   *
   * RTL-sensitive: the origin is Unicode-isolated (card 104) rather than
   * given its own `dir="ltr"` element, and the trailing share/dismiss
   * controls have to mirror to the LEADING edge under `dir="rtl"` — spot-
   * checked live at ar + 320px (see this card's journal on
   * boards/project-backlog/124-storybook-sidepanel-coverage.md).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ContextChip from "./ContextChip.svelte";
  import type { PageInfo } from "../stores/panel.svelte";

  const PAGE: PageInfo = {
    tabId: 1,
    title: "Byzantine Empire - Wikipedia",
    origin: "https://en.wikipedia.org",
    toolCount: 3,
    restricted: false,
    webmcpAvailable: true,
  };

  const RESTRICTED_PAGE: PageInfo = {
    tabId: 2,
    title: "",
    origin: "chrome://extensions",
    toolCount: 0,
    restricted: true,
    webmcpAvailable: true,
  };

  const { Story } = defineMeta({
    title: "Side panel/ContextChip",
    component: ContextChip,
    tags: ["autodocs"],
    parameters: { panelWidth: 400 },
    args: {
      pageInfo: PAGE,
      connectionStatus: "connected",
      onOpenTools: () => undefined,
      sharing: true,
      shareContent: false,
      onSetSharing: () => undefined,
      onSetShareContent: () => undefined,
    },
  });
</script>

<Story name="Sharing" />

<Story name="Sharing, page content included" args={{ shareContent: true }} />

<Story name="Not sharing" args={{ sharing: false }} />

<Story name="Restricted page" args={{ pageInfo: RESTRICTED_PAGE, sharing: true }} />

<Story name="Connecting" args={{ connectionStatus: "connecting" }} />

<Story name="Connection error" args={{ connectionStatus: "error" }} />

<Story name="No active tab" args={{ pageInfo: undefined }} />

<Story name="At 320px" parameters={{ panelWidth: 320 }} />

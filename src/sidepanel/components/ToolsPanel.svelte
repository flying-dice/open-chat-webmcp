<script lang="ts">
  /**
   * Tools view (card 11): everything the active page has actually
   * published on `document.modelContext`, live — this list is exactly
   * `panel.tools`, which src/infra/chrome-runtime/tab-sync.ts keeps in step
   * with the worker's registry as the page registers/unregisters tools, so
   * nothing here needs its own polling or subscription.
   *
   * There are THREE distinct empty states (decisions/16-native-webmcp-client.md
   * card 43, and card 31 for the third) — none is a bare "No tools" line,
   * since this is the FIRST thing most users of this panel will ever see
   * here, and each is worth explaining rather than looking broken:
   *   - `restricted === true`: Chrome never allowed a content script into
   *     this tab at all (chrome://, chrome-extension://, the Web Store, the
   *     built-in PDF viewer, ...) — the worker's own authoritative signal
   *     (RuntimeGetToolsResponse.restricted), not a client-side URL guess.
   *     Nothing will EVER work here; this is checked first since it implies
   *     the other two.
   *   - `webmcpAvailable === false`: a content script IS running here, but
   *     WebMCP itself is unavailable in this browser/for this page (the
   *     feature is off, or this origin has no origin-trial token) —
   *     `document.modelContext` doesn't exist, so there was nothing to even
   *     ask.
   *   - `webmcpAvailable === true` and `tools.length === 0`: the feature
   *     works here, this particular page just hasn't registered anything —
   *     expected, since most sites don't speak WebMCP yet.
   *
   * Card 69 (decisions/28-shadcn-svelte-maia-zinc.md): all four empty
   * states (the three above, plus the "no MCP server tools" case below)
   * render through shadcn's Empty component now, same copy as before.
   */
  import type { SerializedTool } from "../../domain/tools";
  import type { MergedTool } from "../../domain/tools";
  import ToolListItem from "./ToolListItem.svelte";
  import Icon from "./Icon.svelte";
  import * as Empty from "$lib/components/ui/empty";
  import { m } from "../../paraglide/messages.js";

  interface Props {
    tools: SerializedTool[];
    /** Every currently-cached MCP server tool (card 38, decisions/19 §6) — a separate section below the page's own, so it's never possible to mistake a remote tool for something this page published itself. */
    serverTools: MergedTool[];
    webmcpAvailable: boolean;
    restricted: boolean;
    /**
     * decisions/40's sharing gate (card 119). `false` hides this page's tools
     * outright and says why — a FOURTH empty state, and deliberately not
     * "no tools published": the page may well publish plenty, and telling the
     * user it publishes none would be the panel lying to cover its own
     * setting. Like `restricted` it scopes to the page section only; MCP
     * server tools are reached over HTTP from the panel and have nothing to
     * do with what any page may see.
     */
    sharing: boolean;
  }

  let { tools, serverTools, webmcpAvailable, restricted, sharing }: Props = $props();
</script>

<div class="flex min-w-0 flex-col gap-4">
  <!-- `restricted` scopes to THIS SECTION only, not the whole panel: a
       chrome:// page can never have page tools, but MCP server tools are
       reached over HTTP from the panel and are unaffected by it (card 31 +
       card 38, decisions/19 §6). -->
  <section class="flex min-w-0 flex-col gap-2">
    <h2 class="m-0 text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >{m.toolsPanel_thisPageHeading()}</h2
    >
    {#if restricted}
      <Empty.Root class="p-6 text-start md:p-6">
        <Empty.Header class="max-w-none items-start text-start">
          <Empty.Media variant="icon" class="size-9">
            <Icon name="close" class="size-5" />
          </Empty.Media>
          <Empty.Title class="text-base font-medium tracking-tight"
            >{m.toolsPanel_restrictedTitle()}</Empty.Title
          >
          <Empty.Description>
            {@html m.toolsPanel_restrictedDescription()}
          </Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else if !sharing}
      <!-- Checked after `restricted` and before everything else: Chrome's
           refusal outranks the user's choice (there is nothing to withhold on
           a chrome:// page), but the user's choice outranks any statement
           about what this page publishes. -->
      <Empty.Root class="p-6 text-start md:p-6">
        <Empty.Header class="max-w-none items-start text-start">
          <Empty.Media variant="icon" class="size-9">
            <Icon name="public" class="size-5" />
          </Empty.Media>
          <Empty.Title class="text-base font-medium tracking-tight"
            >{m.toolsPanel_notSharingTitle()}</Empty.Title
          >
          <Empty.Description>
            {m.toolsPanel_notSharingDescription()}
          </Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else if !webmcpAvailable}
      <Empty.Root class="p-6 text-start md:p-6">
        <Empty.Header class="max-w-none items-start text-start">
          <Empty.Media variant="icon" class="size-9">
            <Icon name="info" class="size-5" />
          </Empty.Media>
          <Empty.Title class="text-base font-medium tracking-tight"
            >{m.toolsPanel_webmcpOffTitle()}</Empty.Title
          >
          <Empty.Description>
            {@html m.toolsPanel_webmcpOffDescription()}
          </Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else if tools.length === 0}
      <Empty.Root class="p-6 text-start md:p-6">
        <Empty.Header class="max-w-none items-start text-start">
          <Empty.Media variant="icon" class="size-9">
            <Icon name="build" class="size-5" />
          </Empty.Media>
          <Empty.Title class="text-base font-medium tracking-tight"
            >{m.toolsPanel_noPageToolsTitle()}</Empty.Title
          >
          <Empty.Description>
            {@html m.toolsPanel_noPageToolsDescription1()}
          </Empty.Description>
          <Empty.Description>
            {@html m.toolsPanel_noPageToolsDescription2()}
          </Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <ul class="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
        {#each tools as tool (tool.name)}
          <li><ToolListItem tool={{ ...tool, origin: { kind: "page" } }} /></li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="flex min-w-0 flex-col gap-2">
    <h2 class="m-0 text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >{m.toolsPanel_mcpServersHeading()}</h2
    >
    {#if serverTools.length === 0}
      <Empty.Root class="p-6 text-start md:p-6">
        <Empty.Header class="max-w-none items-start text-start">
          <Empty.Media variant="icon" class="size-9">
            <Icon name="terminal" class="size-5" />
          </Empty.Media>
          <Empty.Title class="text-base font-medium tracking-tight"
            >{m.toolsPanel_noServerToolsTitle()}</Empty.Title
          >
          <Empty.Description>
            {m.toolsPanel_noServerToolsDescription()}
          </Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <ul class="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
        {#each serverTools as tool (tool.name)}
          <li><ToolListItem {tool} /></li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

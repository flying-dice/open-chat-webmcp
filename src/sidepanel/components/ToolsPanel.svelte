<script lang="ts">
  /**
   * Tools view (card 11): everything the active page has actually
   * published on `document.modelContext`, live — this list is exactly
   * `panel.tools`, which src/sidepanel/services/activeTab.ts keeps in step
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
  import type { SerializedTool } from "../../infra/chrome-runtime";
  import type { MergedTool } from "../../domain/tools";
  import ToolListItem from "./ToolListItem.svelte";
  import Icon from "./Icon.svelte";
  import * as Empty from "$lib/components/ui/empty";

  interface Props {
    tools: SerializedTool[];
    /** Every currently-cached MCP server tool (card 38, decisions/19 §6) — a separate section below the page's own, so it's never possible to mistake a remote tool for something this page published itself. */
    serverTools: MergedTool[];
    webmcpAvailable: boolean;
    restricted: boolean;
  }

  let { tools, serverTools, webmcpAvailable, restricted }: Props = $props();
</script>

<div class="flex min-w-0 flex-col gap-4">
  <!-- `restricted` scopes to THIS SECTION only, not the whole panel: a
       chrome:// page can never have page tools, but MCP server tools are
       reached over HTTP from the panel and are unaffected by it (card 31 +
       card 38, decisions/19 §6). -->
  <section class="flex min-w-0 flex-col gap-2">
    <h2 class="m-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">This page</h2>
    {#if restricted}
      <Empty.Root class="p-6 text-left md:p-6">
        <Empty.Header class="max-w-none items-start text-left">
          <Empty.Media variant="icon"><Icon name="close" size={20} /></Empty.Media>
          <Empty.Title>This page can't run extension scripts at all.</Empty.Title>
          <Empty.Description>
            Chrome blocks content scripts on <code class="font-mono text-xs">chrome://</code> pages, other
            extensions' pages, the Chrome Web Store, and its built-in PDF viewer —
            there is no way for this or any extension to reach in, so this tab
            will never have page tools, no matter what the page itself supports.
            Chat and MCP server tools still work here.
          </Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else if !webmcpAvailable}
      <Empty.Root class="p-6 text-left md:p-6">
        <Empty.Header class="max-w-none items-start text-left">
          <Empty.Media variant="icon"><Icon name="info" size={20} /></Empty.Media>
          <Empty.Title>WebMCP isn't available in this browser (or on this page).</Empty.Title>
          <Empty.Description>
            <code class="font-mono text-xs">document.modelContext</code> doesn't exist here — WebMCP is
            off by default in Chrome and needs
            <code class="font-mono text-xs">--enable-features=WebMCP</code>, the
            <code class="font-mono text-xs">chrome://flags/#enable-webmcp-testing</code> toggle, or a
            per-origin origin-trial token before a page can use it at all. This
            is different from a page simply not registering any tools — there
            was nothing here to even ask.
          </Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else if tools.length === 0}
      <Empty.Root class="p-6 text-left md:p-6">
        <Empty.Header class="max-w-none items-start text-left">
          <Empty.Media variant="icon"><Icon name="build" size={20} /></Empty.Media>
          <Empty.Title>
            This page hasn't published any WebMCP tools, which is expected — most sites don't yet.
          </Empty.Title>
          <Empty.Description>
            WebMCP is a proposed web standard that lets a page expose specific
            actions and page-state readers — "add a note", "read the cart
            total" — on <code class="font-mono text-xs">document.modelContext</code>, so an AI agent can
            call them directly instead of a human clicking through the UI. It's
            the same idea as MCP, but for what a <em>website</em> itself
            chooses to offer, rather than a separate server.
          </Empty.Description>
          <Empty.Description>
            A site opts in by calling <code class="font-mono text-xs">registerTool()</code> in its own
            page script. If this page did, its tools would show up here the
            moment it registers them — nothing to refresh or configure on your
            end.
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
    <h2 class="m-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">MCP servers</h2>
    {#if serverTools.length === 0}
      <Empty.Root class="p-6 text-left md:p-6">
        <Empty.Header class="max-w-none items-start text-left">
          <Empty.Media variant="icon"><Icon name="terminal" size={20} /></Empty.Media>
          <Empty.Description>
            No MCP server tools are available right now. Add and enable a
            server from the options page's MCP Servers section — a slow,
            unreachable, or not-yet-permitted server simply contributes no
            tools here rather than blocking anything.
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

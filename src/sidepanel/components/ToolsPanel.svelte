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
   */
  import type { SerializedTool } from "../../lib/protocol";
  import type { MergedTool } from "../../lib/mcp/merge";
  import ToolListItem from "./ToolListItem.svelte";

  interface Props {
    tools: SerializedTool[];
    /** Every currently-cached MCP server tool (card 38, decisions/19 §6) — a separate section below the page's own, so it's never possible to mistake a remote tool for something this page published itself. */
    serverTools: MergedTool[];
    webmcpAvailable: boolean;
    restricted: boolean;
  }

  let { tools, serverTools, webmcpAvailable, restricted }: Props = $props();
</script>

<div class="tools-panel">
  <!-- `restricted` scopes to THIS SECTION only, not the whole panel: a
       chrome:// page can never have page tools, but MCP server tools are
       reached over HTTP from the panel and are unaffected by it (card 31 +
       card 38, decisions/19 §6). -->
  <section class="tool-section">
    <h2 class="section-title text-small">This page</h2>
    {#if restricted}
      <div class="empty-state">
        <p><strong>This page can't run extension scripts at all.</strong></p>
        <p class="text-small">
          Chrome blocks content scripts on <code>chrome://</code> pages, other
          extensions' pages, the Chrome Web Store, and its built-in PDF viewer —
          there is no way for this or any extension to reach in, so this tab
          will never have page tools, no matter what the page itself supports.
          Chat and MCP server tools still work here.
        </p>
      </div>
    {:else if !webmcpAvailable}
      <div class="empty-state">
        <p><strong>WebMCP isn't available in this browser (or on this page).</strong></p>
        <p class="text-small">
          <code>document.modelContext</code> doesn't exist here — WebMCP is
          off by default in Chrome and needs
          <code>--enable-features=WebMCP</code>, the
          <code>chrome://flags/#enable-webmcp-testing</code> toggle, or a
          per-origin origin-trial token before a page can use it at all. This
          is different from a page simply not registering any tools — there
          was nothing here to even ask.
        </p>
      </div>
    {:else if tools.length === 0}
      <div class="empty-state">
        <p>
          This page hasn't published any WebMCP tools, which is expected — most
          sites don't yet.
        </p>
        <p class="text-small">
          WebMCP is a proposed web standard that lets a page expose specific
          actions and page-state readers — "add a note", "read the cart
          total" — on <code>document.modelContext</code>, so an AI agent can
          call them directly instead of a human clicking through the UI. It's
          the same idea as MCP, but for what a <em>website</em> itself
          chooses to offer, rather than a separate server.
        </p>
        <p class="text-small">
          A site opts in by calling <code>registerTool()</code> in its own
          page script. If this page did, its tools would show up here the
          moment it registers them — nothing to refresh or configure on your
          end.
        </p>
      </div>
    {:else}
      <ul class="tool-list">
        {#each tools as tool (tool.name)}
          <li><ToolListItem tool={{ ...tool, origin: { kind: "page" } }} /></li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="tool-section">
    <h2 class="section-title text-small">MCP servers</h2>
    {#if serverTools.length === 0}
      <div class="empty-state">
        <p class="text-small">
          No MCP server tools are available right now. Add and enable a
          server from the options page's MCP Servers section — a slow,
          unreachable, or not-yet-permitted server simply contributes no
          tools here rather than blocking anything.
        </p>
      </div>
    {:else}
      <ul class="tool-list">
        {#each serverTools as tool (tool.name)}
          <li><ToolListItem {tool} /></li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .tools-panel {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .tool-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .section-title {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--color-on-surface-variant);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .empty-state p {
    margin: 0;
  }

  .empty-state code {
    font-family: var(--font-family-mono);
    background: var(--color-surface-container);
    border-radius: var(--radius-sm);
    padding: 0 3px;
    overflow-wrap: anywhere;
  }

  .tool-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
</style>

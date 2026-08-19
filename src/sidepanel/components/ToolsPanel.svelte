<script lang="ts">
  /**
   * Tools view (card 11): everything the active page has actually
   * published on `navigator.modelContext`, live — this list is exactly
   * `panel.tools`, which src/sidepanel/services/activeTab.ts keeps in step
   * with the worker's registry as the page registers/unregisters tools, so
   * nothing here needs its own polling or subscription.
   *
   * The empty state is deliberately not a bare "No tools" line: most pages
   * on the web today don't speak WebMCP at all, so this is the FIRST thing
   * most users of this panel will ever see here, and it's worth explaining
   * rather than looking broken (decisions/02-mainworld-webmcp-bridge.md).
   */
  import type { SerializedTool } from "../../lib/protocol";
  import ToolListItem from "./ToolListItem.svelte";

  interface Props {
    tools: SerializedTool[];
  }

  let { tools }: Props = $props();
</script>

<div class="tools-panel">
  {#if tools.length === 0}
    <div class="empty-state">
      <p>
        This page hasn't published any WebMCP tools, which is expected — most
        sites don't yet.
      </p>
      <p class="text-small">
        WebMCP is a proposed web standard that lets a page expose specific
        actions and page-state readers — "add a note", "read the cart
        total" — on <code>navigator.modelContext</code>, so an AI agent can
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
        <li><ToolListItem {tool} /></li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .tools-panel {
    min-width: 0;
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
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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

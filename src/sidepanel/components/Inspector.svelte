<script lang="ts">
  /**
   * The second panel view (card 11): what the page actually published
   * (Tools) and everything the model did with it (Call Log). App.svelte
   * mounts this instead of Transcript+Composer when the user switches away
   * from Chat — see App.svelte's own view switcher for that outer toggle.
   * This component only owns the INNER Tools/Call Log switch; `tools` and
   * `toolCalls` are passed in from panel.svelte.ts (the sole session/tool
   * owner, see that module's header comment) rather than read here
   * directly, matching how Header.svelte/Transcript.svelte are wired.
   */
  import type { SerializedTool } from "../../lib/protocol";
  import type { ToolCallLogEntry } from "../stores/panel.svelte";
  import SegmentedControl from "./SegmentedControl.svelte";
  import ToolsPanel from "./ToolsPanel.svelte";
  import CallLogPanel from "./CallLogPanel.svelte";

  interface Props {
    tools: SerializedTool[];
    toolCalls: ToolCallLogEntry[];
    /** See PageInfo.webmcpAvailable's doc comment (decisions/16, card 43) — distinguishes "WebMCP unavailable in this browser" from "this page has no tools" in the empty state below. */
    webmcpAvailable: boolean;
    /** See PageInfo.restricted's doc comment (card 31) — the third, more fundamental "no content script possible at all" empty state. */
    restricted: boolean;
  }

  let { tools, toolCalls, webmcpAvailable, restricted }: Props = $props();

  let section = $state<"tools" | "log">("tools");

  const sectionOptions = $derived([
    { value: "tools", label: `Tools${tools.length > 0 ? ` (${tools.length})` : ""}` },
    { value: "log", label: `Call Log${toolCalls.length > 0 ? ` (${toolCalls.length})` : ""}` },
  ]);
</script>

<div class="inspector-viewport">
  <div class="section-switch">
    <SegmentedControl
      options={sectionOptions}
      value={section}
      ariaLabel="Inspector section"
      onSelect={(v) => (section = v as "tools" | "log")}
    />
  </div>

  <div class="section-body">
    {#if section === "tools"}
      <ToolsPanel {tools} {webmcpAvailable} {restricted} />
    {:else}
      <CallLogPanel {toolCalls} />
    {/if}
  </div>
</div>

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css and
     src/sidepanel/chat-theme.css (decisions/18). */

  .inspector-viewport {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .section-switch {
    padding: 0 var(--space-3) var(--space-2);
  }

  .section-body {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
    padding: var(--space-3);
  }
</style>

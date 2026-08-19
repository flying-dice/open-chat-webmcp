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
  }

  let { tools, toolCalls }: Props = $props();

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
      <ToolsPanel {tools} />
    {:else}
      <CallLogPanel {toolCalls} />
    {/if}
  </div>
</div>

<style>
  /* All colour/spacing/radius values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .inspector-viewport {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .section-switch {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-outline-variant);
  }

  .section-body {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
    padding: var(--space-3);
  }
</style>

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
   *
   * Card 69 (decisions/28-shadcn-svelte-maia-zinc.md): the inner switch is
   * now shadcn's Tabs directly (rather than through the SegmentedControl
   * wrapper) so each section renders as a real `Tabs.Content` tabpanel —
   * same two values, same labels, same default ("tools").
   */
  import type { SerializedTool } from "../../infra/chrome-runtime";
  import type { MergedTool } from "../../domain/tools";
  import type { ToolCallLogEntry } from "../stores/panel.svelte";
  import ToolsPanel from "./ToolsPanel.svelte";
  import CallLogPanel from "./CallLogPanel.svelte";
  import * as Tabs from "$lib/components/ui/tabs";
  import { ScrollArea } from "$lib/components/ui/scroll-area";

  interface Props {
    tools: SerializedTool[];
    /** Every currently-cached MCP server tool (card 38, decisions/19 §6) — shown in the same Tools view, each clearly labelled with the server it runs on. */
    serverTools: MergedTool[];
    toolCalls: ToolCallLogEntry[];
    /** See PageInfo.webmcpAvailable's doc comment (decisions/16, card 43) — distinguishes "WebMCP unavailable in this browser" from "this page has no tools" in the empty state below. */
    webmcpAvailable: boolean;
    /** See PageInfo.restricted's doc comment (card 31) — the third, more fundamental "no content script possible at all" empty state. */
    restricted: boolean;
  }

  let { tools, serverTools, toolCalls, webmcpAvailable, restricted }: Props = $props();

  let section = $state<"tools" | "log">("tools");

  const totalTools = $derived(tools.length + serverTools.length);
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <Tabs.Root
    value={section}
    onValueChange={(v) => (section = v as "tools" | "log")}
    class="flex min-h-0 flex-1 flex-col gap-0"
  >
    <div class="px-3 pb-2">
      <Tabs.List aria-label="Inspector section" class="w-full">
        <Tabs.Trigger value="tools" class="flex-1">
          Tools{totalTools > 0 ? ` (${totalTools})` : ""}
        </Tabs.Trigger>
        <Tabs.Trigger value="log" class="flex-1">
          Call Log{toolCalls.length > 0 ? ` (${toolCalls.length})` : ""}
        </Tabs.Trigger>
      </Tabs.List>
    </div>

    <ScrollArea class="min-h-0 flex-1">
      <Tabs.Content value="tools" class="px-3 pb-3">
        <ToolsPanel {tools} {serverTools} {webmcpAvailable} {restricted} />
      </Tabs.Content>
      <Tabs.Content value="log" class="px-3 pb-3">
        <CallLogPanel {toolCalls} />
      </Tabs.Content>
    </ScrollArea>
  </Tabs.Root>
</div>

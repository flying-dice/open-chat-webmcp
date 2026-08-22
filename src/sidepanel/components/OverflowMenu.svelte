<script lang="ts">
  /**
   * The header's kebab overflow menu (decisions/18, re-skinned onto
   * shadcn's DropdownMenu by decisions/28): recent chats, the tool
   * inspector, and settings, in one anchored dropdown.
   *
   * This replaces the Chat / Tools & Log / History segmented control that
   * used to eat a whole row under the header. At 320px a permanent tab
   * strip costs more than it earns — you are in the chat almost always, and
   * the other two views are somewhere you visit, not somewhere you switch
   * between.
   *
   * Flat, single-level menu: settings used to sit behind a "Back"-style
   * submenu, but with exactly one action (open options) and one read-only
   * status line under it, a second level bought nothing but an extra tap —
   * both now live directly in the root list.
   *
   * Recent chats are re-listed every time the menu opens rather than kept
   * live: `listChatSummaries` reads `chat:index` only (no message bodies),
   * and a menu that is closed has nothing to keep fresh.
   *
   * DropdownMenu.Root/Trigger/Content/Item bring their own open-state
   * management, click-outside/Escape dismissal, and arrow-key/Home/End/
   * type-ahead roving focus (bits-ui) — the old version only had Escape and
   * click-outside hand-wired, so this is a strict superset of its keyboard
   * behaviour. The trigger button is composed directly here (Button +
   * Icon) rather than through IconButton.svelte: DropdownMenu.Trigger needs
   * its merged props attached straight onto the actual `<button>` element
   * (bits-ui's `child` snippet pattern), which IconButton has no hook to
   * accept.
   */
  import Icon from "./Icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { cn } from "$lib/utils";
  import type { ChatSummary } from "../../domain/chat";
  import { chat, sidePanelServices } from "../app-services";
  import { panel, type ConnectionStatus } from "../stores/panel.svelte";
  import { openOptionsPage } from "../stores/selection.svelte";
  import { titleFromSummary } from "../../domain/chat";

  interface Props {
    /** Open the full history view. */
    onOpenHistory: () => void;
    /** Open the tools & call log view. */
    onOpenTools: () => void;
    /** Switch back to the chat view — called only once a recent-chat open actually succeeds. */
    onOpenChat: () => void;
    connectionStatus: ConnectionStatus;
  }

  const { onOpenHistory, onOpenTools, onOpenChat, connectionStatus }: Props = $props();

  /** How many chats the top level lists before deferring to "More". Five is what fits above the divider without the menu needing to scroll at a typical panel height. */
  const RECENT_LIMIT = 5;

  let summaries = $state<ChatSummary[]>([]);

  // TODO: clean-code - 0.4 - DRY: identical statusLabel lookup table declared independently in ContextChip.svelte instead of exported once from src/sidepanel/presentation/, the pattern capabilityBadge.ts/toolOrigin.ts already establish for exactly this kind of shared wording.
  const statusLabel: Record<ConnectionStatus, string> = {
    unknown: "Not connected",
    connecting: "Connecting…",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Connection error",
  };

  const recent = $derived(summaries.slice(0, RECENT_LIMIT));
  const hasMore = $derived(summaries.length > RECENT_LIMIT);

  function handleOpenChange(open: boolean): void {
    if (open) void sidePanelServices().chats.listChatSummaries().then((s) => (summaries = s));
  }

  async function handleOpenChat(id: string): Promise<void> {
    if (await chat().openChat(id)) onOpenChat();
  }
</script>

<DropdownMenu.Root onOpenChange={handleOpenChange}>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        type="button"
        variant="ghost"
        size="icon-sm"
        class="rounded-full"
        aria-label="More options"
      >
        <Icon name="more_vert" class="size-4" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>

  <DropdownMenu.Content
    align="end"
    aria-label="Panel menu"
    class="w-[335px] max-w-[calc(100vw-1rem)]"
  >
    <DropdownMenu.Label>Recent chats</DropdownMenu.Label>

    {#if recent.length === 0}
      <p class="px-3 py-2 text-xs text-muted-foreground">No chats yet.</p>
    {:else}
      {#each recent as summary (summary.id)}
        <DropdownMenu.Item
          class={cn(summary.id === panel.activeChatId && "bg-accent text-accent-foreground")}
          onSelect={() => void handleOpenChat(summary.id)}
        >
          <Icon name="subject" class="size-4" />
          <span class="min-w-0 flex-1 truncate">{titleFromSummary(summary)}</span>
        </DropdownMenu.Item>
      {/each}
    {/if}

    {#if hasMore || recent.length > 0}
      <DropdownMenu.Item onSelect={onOpenHistory}>
        <Icon name="more_horiz" class="size-4" />
        <span class="min-w-0 flex-1 truncate">More</span>
        <Icon name="chevron_right" class="size-4" />
      </DropdownMenu.Item>
    {/if}

    <DropdownMenu.Separator />

    <DropdownMenu.Item onSelect={onOpenTools}>
      <Icon name="build" class="size-4" />
      <span class="min-w-0 flex-1 truncate">Tools &amp; call log</span>
    </DropdownMenu.Item>

    <DropdownMenu.Item onSelect={openOptionsPage}>
      <Icon name="settings" class="size-4" />
      <span class="min-w-0 flex-1 truncate">Open options</span>
      <Icon name="open_in_new" class="size-4" />
    </DropdownMenu.Item>

    <!-- Not a control: the connection state has no action attached to it,
         it is just the one place in the menu you can read it. -->
    <DropdownMenu.Label>
      <span class="flex items-center gap-2.5">
        <Icon name="info" class="size-4" />
        {statusLabel[connectionStatus]}
      </span>
    </DropdownMenu.Label>
  </DropdownMenu.Content>
</DropdownMenu.Root>

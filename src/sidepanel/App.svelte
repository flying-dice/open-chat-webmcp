<script lang="ts">
  // Side panel app shell (card 07): header / transcript / composer, laid
  // out to stay usable down to ~320px (decisions/01, decisions/08).
  //
  // Every service this shell calls arrives from src/sidepanel/app-services.ts,
  // wired once by src/sidepanel/main.ts (card 78) — this component constructs
  // nothing and names no adapter. The tab sync and the pagehide flush that
  // used to live in `onMount` below moved to that root with the rest of the
  // surface's lifecycle.
  //
  // `handleSend` is the agent loop's (card 08) entry point: it resolves the
  // active provider+model from src/sidepanel/stores/selection.svelte.ts,
  // decides whether to attach page tools (only when
  // `selection.activeCapability?.status === "tool-capable"`, decisions/11),
  // and hands off to src/sidepanel/services/chatTurn.ts's `sendTurn`, the
  // thin assembler in front of src/domain/chat's `runTurn`, which streams the
  // reply and drives tool-call execution/approval from there. `requestApproval` is card 09's real approve/deny UI
  // (src/sidepanel/stores/approvals.svelte.ts) — Transcript.svelte renders
  // its pending requests as inline ApprovalCards, and its `policy` state is
  // kept in sync with settings.ts's global override for the lifetime of
  // this component via `initApprovalPolicySync` below.
  // `view` (card 11) switches the panel's main area between the chat
  // transcript and the tools/call-log inspector — purely local UI state,
  // not persisted, since it's a view choice rather than session content
  // (panel.svelte.ts's SINGLE OWNER note is about `ChatSession`, not this).
  // Since decisions/18 there is no permanent view switcher: the two
  // non-chat views are entered from the overflow menu and left by a "Back"
  // row, so chat — which is where you are nearly always — gets the whole
  // panel instead of paying a tab strip for the other two.
  import { onMount } from "svelte";
  import Header from "./components/Header.svelte";
  import Transcript from "./components/Transcript.svelte";
  import Composer from "./components/Composer.svelte";
  import ProviderPicker from "./components/ProviderPicker.svelte";
  import ContextChip from "./components/ContextChip.svelte";
  import NoticeCard from "./components/NoticeCard.svelte";
  import OverflowMenu from "./components/OverflowMenu.svelte";
  import IconButton from "./components/IconButton.svelte";
  import Inspector from "./components/Inspector.svelte";
  import HistoryPanel from "./components/HistoryPanel.svelte";
  import { titleFromMessages } from "../domain/chat";
  import { initMcpToolsSync } from "./services/mcpTools";
  import { sendTurn } from "./services/chatTurn";
  import { iconForProvider } from "../ui/providerIcon";
  import { chat, sidePanelServices } from "./app-services";
  import { selection } from "./stores/selection.svelte";
  import { panel, requestStop } from "./stores/panel.svelte";
  import { dismissAllPending, initApprovalPolicySync, requestApproval } from "./stores/approvals.svelte";

  let view = $state<"chat" | "inspector" | "history">("chat");

  /**
   * The header's title: the conversation's own name in chat (its explicit
   * `title` when set — decisions/24 — else derived from the first message),
   * the view's name elsewhere, so the header always says where you are.
   */
  const headerTitle = $derived(
    view === "inspector"
      ? "Tools & call log"
      : view === "history"
        ? "Chat history"
        : titleFromMessages(panel.messages, panel.activeChatTitle),
  );

  /** The model answering in this chat, shown on each assistant turn. `undefined` until something is actually resolved. */
  const modelLabel = $derived(
    selection.resolution.status === "ok" ? selection.resolution.model : undefined,
  );

  /** Which provider produced (or will produce) that reply — falls back to the generic `sparkle` glyph until a provider is actually resolved, same as `modelLabel` falling back to `undefined`. */
  const modelIcon = $derived(
    selection.resolution.status === "ok" ? iconForProvider(selection.resolution.config) : "sparkle",
  );

  /**
   * Card 34/decisions/13's cross-origin-open honesty notice: set whenever
   * the chat currently loaded (possibly opened from the History view
   * against a different tab entirely) was started against an origin other
   * than the one this tab is actually showing right now. Page tools always
   * come from `panel.pageInfo`/`panel.tools` regardless — this only exists
   * so the UI never implies a tool call earlier in the transcript could be
   * re-run here.
   */
  const chatOriginMismatch = $derived.by(():
    | { chatOrigin: string; pageOrigin: string }
    | undefined => {
    const chatOrigin = panel.activeChatOrigin;
    const pageOrigin = panel.pageInfo?.origin;
    if (!chatOrigin || !pageOrigin || chatOrigin === pageOrigin) return undefined;
    return { chatOrigin, pageOrigin };
  });

  /**
   * The cross-origin notice is an announcement — read once, then out of the
   * way — so it can be dismissed. Keyed by chat id rather than a plain
   * boolean: dismissing it for THIS chat must not silence it for the next
   * one opened against a different origin.
   *
   * The restricted-page notice deliberately has no dismiss: it reflects
   * live capability, not an announcement, and it has to come back every
   * time the state does.
   */
  let dismissedMismatchFor = $state<string | undefined>(undefined);
  const showMismatchNotice = $derived(
    chatOriginMismatch !== undefined && dismissedMismatchFor !== panel.activeChatId,
  );

  /** The last user turn actually sent — card 14's Retry action chip resends this rather than requiring the user to retype it. Updated on every send, including a retry, so retrying twice in a row still resends the same original text. */
  let lastSentText = $state("");

  /** Instance ref so `handleNewChat` (card 36) can put focus back in the composer after retiring the current chat — see Composer.svelte's exported `focusInput`. */
  let composerRef: Composer | undefined = $state();

  /**
   * First-run note for the chat view's empty state (card 14): explains why
   * there's nothing extra to call here, WITHOUT dead-ending — chat itself
   * always stays available. `undefined` for a restricted page — the
   * persistent `.restricted-banner` below already covers that case (visible
   * in both views, not just this first-run moment), so this only ever adds
   * the *ordinary* "no tools published" wording, never repeats it. Also
   * deliberately different wording from ToolsPanel.svelte's inspector-view
   * empty state (which goes into what WebMCP is) — this one is a brief
   * aside, not the main content of the view.
   */
  const toolsNotice = $derived.by((): string | undefined => {
    const info = panel.pageInfo;
    if (!info || info.restricted) return undefined;
    if (info.toolCount === 0) {
      return "This page hasn't published any WebMCP tools, so there's nothing extra to call here — plain chat works exactly the same.";
    }
    return undefined;
  });

  onMount(() => {
    const teardownPolicySync = initApprovalPolicySync();
    // Card 38 (decisions/19 §4): kicks the first MCP server discovery
    // immediately and keeps it refreshed in the background for the panel's
    // lifetime, so a turn's per-turn merge (src/sidepanel/services/chatTurn.ts)
    // almost always finds something already cached rather than starting cold.
    const teardownMcpToolsSync = initMcpToolsSync();

    return () => {
      teardownPolicySync();
      teardownMcpToolsSync();
    };
  });

  /**
   * Stop must also clear any approve/deny card still showing: the turn's
   * `raceApproval` already treats an aborted turn's outstanding approval as
   * "denied" so the loop itself unblocks immediately, but it has no way to
   * settle THIS module's promise or remove the card — without this call, a
   * card the loop has already moved past would be left on screen forever.
   */
  function handleStop(): void {
    requestStop();
    dismissAllPending();
  }

  /**
   * Card 36 (boards/project-backlog/36-new-chat-action.md): retire the
   * current chat to history and start a fresh one for the page currently in
   * front of the user, carrying the provider/model selection over
   * (`ChatService.startNewChat`'s job — see src/domain/chat/service.ts) and landing
   * focus in the composer.
   *
   * Sensible-empty-chat behaviour: if the current chat has no messages yet,
   * there is nothing to retire — calling it anyway would just
   * create a second, indistinguishable empty chat sitting next to this one
   * (never visible in History either, since HistoryPanel only lists a chat
   * once it has a message). So this only actually swaps chats when there's
   * something in the current one to retire; either way, focus still lands
   * in the composer, since "start typing" is the point of the action.
   *
   * Also refuses while a turn is in flight — swapping the live session out
   * from under a running turn's in-flight mutators would silently orphan
   * it (its deltas/tool calls would keep looking up state in the OLD
   * session's messages, but nothing reads that session anymore). Reads
   * `panel.isTurnActive` (decisions/26, card 60), not `panel.isStreaming` —
   * the latter goes false for the entire tool-execution round, which used
   * to let a new chat be started mid-tool-round and orphan the turn exactly
   * then. Matches the Header button's own `disabled` guard below, this is
   * the belt to that braces.
   */
  async function handleNewChat(): Promise<void> {
    const info = panel.pageInfo;
    if (!info || panel.isTurnActive) return;
    if (panel.messages.length > 0) {
      await chat().startNewChat(info.origin);
    }
    composerRef?.focusInput();
  }

  function handleSend(text: string): void {
    lastSentText = text;

    const resolution = selection.resolution;
    const tabId = panel.pageInfo?.tabId;

    // Card 35: the composer is disabled in all of these cases already
    // (Composer.svelte's `blocked` derivation mirrors this exact check plus
    // `selection.needsConfirmation`), so this is defence-in-depth against a
    // send reaching here some other way — not the primary UI.
    if (resolution.status !== "ok" || tabId === undefined || selection.needsConfirmation) {
      chat().addUserMessage(text);
      const noProviders = selection.providers.length === 0;
      chat().addAssistantNote(
        noProviders
          ? "No provider is registered yet — add one on the options page, then pick it from the picker in the header."
          : "No provider/model selected yet — pick one from the picker in the header before sending a message.",
        noProviders ? [{ kind: "open-options", label: "Open options to add a provider" }] : undefined,
      );
      return;
    }

    // Card 75: `createProviderClient` is the exhaustive dispatcher from
    // src/domain/providers/client-factory.ts — there is no "unregistered
    // provider type" state left to throw for, so this no longer needs a
    // try/catch around client construction. Card 78: it arrives as a port
    // from src/sidepanel/app-services.ts, built once by the composition root,
    // instead of being imported from an interim wiring module.
    const provider = sidePanelServices().createProviderClient(resolution.config);

    void sendTurn(text, {
      provider,
      model: resolution.model,
      tabId,
      pageTitle: panel.pageInfo?.title ?? "",
      pageOrigin: panel.pageInfo?.origin ?? "",
      attachTools: selection.activeCapability?.status === "tool-capable",
      requestApproval,
    });
  }

  /**
   * Card 14's Retry chip and the per-reply Regenerate action: resend the
   * last user turn exactly as if retyped. Never touches the failed turn's
   * messages — the partial reply and the error note both stay on screen;
   * this only starts a new one below them.
   *
   * Sourced from the transcript rather than from `lastSentText`, which is
   * only populated by a send in THIS panel lifetime: after the panel is
   * closed and reopened (or reloaded) the in-memory copy is empty while the
   * message itself is still right there in the restored session, and Retry
   * would silently do nothing. The in-memory value is still preferred when
   * present, so retrying twice resends the same original text.
   */
  function handleRetry(): void {
    const text = lastSentText || panel.messages.findLast((m) => m.role === "user")?.content;
    if (!text) return;
    handleSend(text);
  }

  /**
   * Card 56 (decisions/24-explicit-chat-titles.md): the header's inline
   * rename. Passed to `Header` ONLY in chat view (see the template below) so
   * the inspector/history titles stay non-editable — `renameCurrent`
   * itself already no-ops without a loaded chat, but the header must
   * never even offer the affordance outside chat, per the "opt-in per
   * render, never inferred" rule.
   */
  function handleRename(title: string): void {
    void chat().renameCurrent(title);
  }
</script>

<div class="flex h-screen min-w-[320px] flex-col">
  <Header
    title={headerTitle}
    newChatDisabled={!panel.pageInfo || panel.isTurnActive}
    onNewChat={handleNewChat}
    onRename={view === "chat" ? handleRename : undefined}
  >
    {#snippet menu()}
      <OverflowMenu
        connectionStatus={panel.connectionStatus}
        onOpenHistory={() => (view = "history")}
        onOpenTools={() => (view = "inspector")}
        onOpenChat={() => (view = "chat")}
      />
    {/snippet}
  </Header>

  {#if view === "chat"}
    <Transcript
      messages={panel.messages}
      streamingMessageId={panel.streamingMessageId}
      turnPhase={panel.turnPhase}
      onRetry={handleRetry}
      {toolsNotice}
      {modelLabel}
      {modelIcon}
    >
      {#snippet notices()}
        {#if panel.pageInfo?.restricted}
          <NoticeCard>
            <p>
              This page doesn't allow browser extensions to run scripts on it, so nothing here
              will ever have page tools — chat still works exactly the same.
            </p>
          </NoticeCard>
        {/if}
        {#if showMismatchNotice && chatOriginMismatch}
          <NoticeCard
            dismissLabel="Dismiss origin notice"
            onDismiss={() => (dismissedMismatchFor = panel.activeChatId)}
          >
            <p>
              This chat was started on <strong>{chatOriginMismatch.chatOrigin}</strong>. You're
              viewing it from <strong>{chatOriginMismatch.pageOrigin}</strong> — the transcript
              stays readable, but page tools come from THIS tab only, and any tool calls above
              belong to the original page and can't be re-run here.
            </p>
          </NoticeCard>
        {/if}
      {/snippet}
    </Transcript>

    <div class="flex flex-none flex-col gap-0 px-3 pt-2 pb-3">
      <ContextChip
        pageInfo={panel.pageInfo}
        connectionStatus={panel.connectionStatus}
        onOpenTools={() => (view = "inspector")}
      />
      <Composer
        bind:this={composerRef}
        busy={panel.isTurnActive}
        onSend={handleSend}
        onStop={handleStop}
      >
        {#snippet picker()}
          <ProviderPicker />
        {/snippet}
      </Composer>
    </div>
  {:else}
    <!-- Non-chat views take the whole panel below the header, and are left
         the way the reference's submenus are: by a Back row, not by a tab
         strip that would have to sit there permanently. -->
    <div class="flex flex-none items-center px-2 pb-1">
      <IconButton
        icon="arrow_back"
        label="Back to chat"
        onclick={() => (view = "chat")}
        tooltipPlacement="bottom"
      />
    </div>

    {#if view === "inspector"}
      <Inspector
        tools={panel.tools}
        serverTools={panel.serverTools}
        toolCalls={panel.toolCalls}
        webmcpAvailable={panel.pageInfo?.webmcpAvailable ?? true}
        restricted={panel.pageInfo?.restricted ?? false}
      />
    {:else}
      <HistoryPanel onOpenChat={() => (view = "chat")} />
    {/if}
  {/if}
</div>

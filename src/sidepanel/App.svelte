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
  import { onMount, tick } from "svelte";
  import Header from "./components/Header.svelte";
  import Transcript from "./components/Transcript.svelte";
  import Composer from "./components/Composer.svelte";
  import ModelPicker from "./components/ModelPicker.svelte";
  import ContextChip from "./components/ContextChip.svelte";
  import SelectionChip from "./components/SelectionChip.svelte";
  import NoticeCard from "./components/NoticeCard.svelte";
  import OverflowMenu from "./components/OverflowMenu.svelte";
  import IconButton from "./components/IconButton.svelte";
  import Inspector from "./components/Inspector.svelte";
  import HistoryPanel from "./components/HistoryPanel.svelte";
  import { titleFromMessages } from "../domain/chat";
  import { isSelectionUsable } from "../domain/providers";
  import { initMcpToolsSync } from "./services/mcpTools";
  import { sendTurn } from "./services/chatTurn";
  import { iconForProvider } from "../ui/providerIcon";
  import { chat, sidePanelServices } from "./app-services";
  import { selection } from "./stores/selection.svelte";
  import { panel, requestStop } from "./stores/panel.svelte";
  import {
    collectTurnContext,
    dismissSelection,
    initPageSharingSync,
    pageSharing,
    refreshSelection,
    setShareContent,
    setSharing,
  } from "./stores/pageSharing.svelte";
  import { dismissNotice, panelNotices, reportNotice } from "./stores/notices.svelte";
  import { storageFailureMessage } from "../ui/storageMessage";
  import { isSpokenPhase, turnStatusSentence } from "./presentation/turnStatus";
  import {
    dismissAllPending,
    initApprovalPolicySync,
    requestApproval,
  } from "./stores/approvals.svelte";
  import { m } from "../paraglide/messages.js";

  type View = "chat" | "inspector" | "history";

  let view = $state<View>("chat");

  /**
   * CARD 115 — WHERE FOCUS GOES WHEN THE VIEW CHANGES.
   *
   * Every one of these switches replaces the whole panel below the header,
   * and the control that triggered the switch is usually part of what gets
   * unmounted: the menu row that opened Tools, the "Back to chat" button that
   * closed it, the context strip's own chevron. Chrome then drops focus to
   * `<body>`, which the audit confirmed on all three paths — a keyboard user
   * has to Tab back in from the top of the document, and a screen-reader user
   * is told nothing happened at all.
   *
   * So the switch is a function, not three inline `view = …` assignments, and
   * it lands focus deliberately:
   *
   *   into a subview → the "Back to chat" row. It is that view's first
   *     control, and its label states both where you are and how to leave.
   *   back to chat   → the composer, i.e. the thing "back to chat" is FOR.
   *     `focusInput` reports whether it landed (the blocked composer has no
   *     textarea to focus), and the shell itself — `tabindex="-1"` — takes it
   *     otherwise, so this can never silently fall through to `body`.
   *
   * `tick()` first: the target does not exist until Svelte has flushed the
   * new view.
   */
  let backButton = $state<HTMLButtonElement | null>(null);
  let shellEl = $state<HTMLDivElement | null>(null);

  function switchView(next: View): void {
    const previous = view;
    view = next;
    if (previous === next) return;
    void tick().then(() => {
      if (next !== "chat") {
        backButton?.focus();
        return;
      }
      if (!composerRef?.focusInput()) shellEl?.focus();
    });
  }

  /**
   * The header's title: the conversation's own name in chat (its explicit
   * `title` when set — decisions/24 — else derived from the first message),
   * the view's name elsewhere, so the header always says where you are.
   */
  const headerTitle = $derived(
    view === "inspector"
      ? m.app_inspectorTitle()
      : view === "history"
        ? m.app_historyTitle()
        : titleFromMessages(panel.messages, m.chatTitle_untitled(), panel.activeChatTitle),
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
   * The panel's ONE polite live region (card 115). A screen-reader user got
   * nothing at all while a turn ran: the reply streams into the transcript
   * with no live region on it, and the tail indicator's own `aria-live`
   * announced unreliably and disappeared with the turn (see
   * ActivityIndicator.svelte's header).
   *
   * What it says, and what it deliberately does not:
   *   - the waiting/calling sentence, from the same `turnStatusSentence` the
   *     visible indicator renders — so it changes at most once per tool call,
   *     never per token. That throttling is structural, not a timer.
   *   - one line when the turn ends, which is the moment a screen-reader user
   *     needs to know the reply is there to go and read.
   *   - NOTHING for `streaming` (the arriving text is its own feedback) or
   *     `awaiting-approval` (ApprovalCard.svelte moves focus into itself,
   *     which announces strictly more than a live region could, and saying it
   *     twice is the spam this card exists to remove).
   *
   * `turnWasActive` is a plain `let`, not `$state`: it is this effect's own
   * bookkeeping and must never make the effect re-run.
   */
  let liveStatus = $state("");
  let turnWasActive = false;

  $effect(() => {
    const phase = panel.turnPhase;
    if (phase) {
      turnWasActive = true;
      if (isSpokenPhase(phase)) liveStatus = turnStatusSentence(phase, modelLabel);
      return;
    }
    if (turnWasActive) {
      turnWasActive = false;
      liveStatus = m.app_turnFinishedAnnouncement();
    }
  });

  /**
   * Card 34/decisions/13's cross-origin-open honesty notice: set whenever
   * the chat currently loaded (possibly opened from the History view
   * against a different tab entirely) was started against an origin other
   * than the one this tab is actually showing right now. Page tools always
   * come from `panel.pageInfo`/`panel.tools` regardless — this only exists
   * so the UI never implies a tool call earlier in the transcript could be
   * re-run here.
   */
  const chatOriginMismatch = $derived.by(
    (): { chatOrigin: string; pageOrigin: string } | undefined => {
      const chatOrigin = panel.activeChatOrigin;
      const pageOrigin = panel.pageInfo?.origin;
      if (!chatOrigin || !pageOrigin || chatOrigin === pageOrigin) return undefined;
      return { chatOrigin, pageOrigin };
    },
  );

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
    // Card 119 (decisions/40): with the gate down this note would state
    // something about the page the panel has just promised not to look at —
    // and "no tools published" would be a claim we cannot make while we are
    // deliberately not asking. The chip already says why the panel is quiet.
    if (!pageSharing.sharing) return undefined;
    if (info.toolCount === 0) {
      return m.app_toolsNotice();
    }
    return undefined;
  });

  /**
   * The IDENTITY of the page the panel is pointed at — card 119's second
   * trigger for a selection pull, alongside the panel taking focus.
   *
   * Derived to a string on purpose. `panel.pageInfo` is reassigned wholesale
   * on a bare title or favicon change too (see panel.svelte.ts's
   * `pageMetaChanged`), and an effect reading the object itself would turn
   * every one of those into a page read the user never asked for — precisely
   * what decisions/40 forbids. Recomputing this to the SAME string leaves the
   * effect below asleep.
   */
  const pageIdentity = $derived(
    panel.pageInfo ? `${panel.pageInfo.tabId} ${panel.pageInfo.origin}` : "",
  );

  // A tab switch, a navigation, or the very first page resolving after the
  // panel opened: in each the chip is now about a different page and has to
  // be re-read. `refreshSelection` is a no-op for a restricted page or a
  // dismissed gate, so this cannot pull behind the gate.
  $effect(() => {
    void pageIdentity;
    void refreshSelection();
  });

  onMount(() => {
    const teardownPolicySync = initApprovalPolicySync();
    // Card 38 (decisions/19 §4): kicks the first MCP server discovery
    // immediately and keeps it refreshed in the background for the panel's
    // lifetime, so a turn's per-turn merge (src/sidepanel/services/chatTurn.ts)
    // almost always finds something already cached rather than starting cold.
    const teardownMcpToolsSync = initMcpToolsSync();
    // Card 119 (decisions/40): pulls the active tab's selection when this
    // panel takes focus — the moment the user comes back from highlighting
    // something — and never at any other time of its own accord. Behind the
    // sharing gate, so a dismissed page is never asked.
    const teardownPageSharingSync = initPageSharingSync();

    return () => {
      teardownPolicySync();
      teardownMcpToolsSync();
      teardownPageSharingSync();
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
      // Card 95: `startNewChat` writes the tab's pointer BEFORE swapping the
      // visible chat (src/domain/chat/service.ts), so an error here means
      // nothing changed — the conversation the user had is still on screen,
      // and the notice is the whole of what they need to know.
      const [, err] = await chat().startNewChat(info.origin);
      if (err) reportNotice(storageFailureMessage(m.app_startChatFailedWhat(), err));
    }
    composerRef?.focusInput();
  }

  // TODO: clean-code - 0.25 - SRP: handleSend mixes UI validation branching (no-provider/no-selection guards) with fallback assistant-note authoring and turn-dispatch assembly, rather than delegating the fallback messaging entirely to a service. STAYS: the two guards are about what this SHELL can offer — no provider registered, nothing selected — and their answer is to open this shell's own picker and write a note into this shell's transcript. A service that authored them would have to be handed the picker and the localized copy back, which is the same coupling with an indirection in front. The dispatch half is already delegated (sendTurn -> src/domain/chat's runTurn).
  function handleSend(text: string): void {
    lastSentText = text;

    const resolution = selection.resolution;
    const tabId = panel.pageInfo?.tabId;

    // Card 35: the composer is disabled in all of these cases already
    // (Composer.svelte's `blocked` derivation mirrors this exact check via
    // the shared `isSelectionUsable`), so this is defence-in-depth against a
    // send reaching here some other way — not the primary UI.
    if (!isSelectionUsable(resolution, selection.needsConfirmation) || tabId === undefined) {
      chat().addUserMessage(text);
      const noProviders = selection.providers.length === 0;
      // Card 114 (decisions/38): the KIND is stored, not the sentence — this
      // note is persisted, and a chat recorded while the panel was in one
      // language must not read in that language forever. The words are
      // src/sidepanel/presentation/transcriptNote.ts's, chosen at render.
      chat().addAssistantNote(
        noProviders ? { kind: "no-provider" } : { kind: "no-selection" },
        noProviders ? [{ kind: "open-options", reason: "add-provider" }] : undefined,
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
    const pageTitle = panel.pageInfo?.title ?? "";
    const pageOrigin = panel.pageInfo?.origin ?? "";

    // Card 119 (decisions/40): the send is the second of the two gestures a
    // page-context pull is allowed to happen on, and the authoritative one —
    // the user may have changed their selection while typing.
    // `collectTurnContext` is the whole of the gate's UI-side enforcement: it
    // pulls nothing and returns nothing while sharing is dismissed, so a
    // dismissal made between the chip appearing and Send being pressed is
    // honoured by the turn that send starts.
    //
    // CARD 120 MOVED THE SEAM. This used to `await collectTurnContext()`
    // right here, before `sendTurn` — which meant that on a page whose main
    // thread is wedged, Send did nothing visible for up to three seconds
    // (card 118's pull rung) before the user's own message appeared. The
    // collector is now handed to the turn instead of called in front of it:
    // `ChatService.runTurn` appends the message, captures its chat and
    // registers the turn synchronously, then pulls. Nothing about the gate
    // moved — `collectTurnContext` still reads it at attach time, and
    // `sharingAllowed` is read at the moment Send is pressed, which is the
    // same instant for every case the gate is about.
    void sendTurn(text, {
      provider,
      model: resolution.model,
      tabId,
      pageTitle,
      pageOrigin,
      attachTools: pageSharing.sharing && selection.activeCapability?.status === "tool-capable",
      sharingAllowed: pageSharing.sharing,
      pageContext: collectTurnContext,
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
  async function handleRename(title: string): Promise<void> {
    // Card 95: the new name is already on screen (the service applies it to
    // the live session before writing), so the notice says it is not durable
    // rather than yanking the name back out from under the user.
    const [, err] = await chat().renameCurrent(title);
    if (err) reportNotice(storageFailureMessage(m.app_renameFailedWhat(), err));
  }
</script>

<!-- `tabindex="-1"` is the focus fallback `switchView` needs, never a tab
     stop (a negative tabindex is skipped by Tab); `outline-none` because a
     shell that has taken focus programmatically should not draw a ring around
     the entire panel. -->
<div
  bind:this={shellEl}
  tabindex="-1"
  class="flex h-screen min-w-[320px] flex-col outline-none"
>
  <Header
    title={headerTitle}
    newChatDisabled={!panel.pageInfo || panel.isTurnActive}
    onNewChat={handleNewChat}
    onRename={view === "chat" ? handleRename : undefined}
  >
    {#snippet menu()}
      <OverflowMenu
        connectionStatus={panel.connectionStatus}
        onOpenHistory={() => switchView("history")}
        onOpenTools={() => switchView("inspector")}
        onOpenChat={() => switchView("chat")}
      />
    {/snippet}
  </Header>

  <!-- Card 115's single polite region. Always mounted (a live region has to
       exist BEFORE its content changes for a screen reader to speak it) and
       `aria-atomic` so each sentence is read whole rather than diffed word by
       word. Drawn nowhere: the sighted equivalent is the tail
       ActivityIndicator, which says the same thing. -->
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveStatus}</div>

  <!-- Card 115: the panel had no landmarks at all, so a screen reader offered
       no way to jump past the header to the conversation, and axe reported
       every block of transcript content as orphaned (`region`,
       `landmark-one-main`). The header above is already a `<header>` at
       document level, i.e. a banner; this is the other half. It wraps the
       `{#if}` rather than sitting inside each branch so the landmark survives
       a view switch instead of being torn down and rebuilt with it. -->
  <main class="flex min-h-0 flex-1 flex-col">
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
        <!-- Card 95: the panel's one notice channel
             (src/sidepanel/stores/notices.svelte.ts). Every storage failure a
             user's own action caused — a chat that would not open, a rename or
             a model choice that did not persist — lands here as a value rather
             than in the console. Always dismissible: each one is an
             announcement about something that already happened, never live
             state. -->
        {#each panelNotices.all as notice (notice.id)}
          <NoticeCard
            variant="failure"
            dismissLabel={m.app_dismissMessageLabel()}
            onDismiss={() => dismissNotice(notice.id)}
          >
            <p>{notice.message}</p>
          </NoticeCard>
        {/each}
        {#if panel.pageInfo?.restricted}
          <NoticeCard>
            <p>
              {m.app_restrictedPageNotice()}
            </p>
          </NoticeCard>
        {/if}
        {#if showMismatchNotice && chatOriginMismatch}
          <NoticeCard
            dismissLabel={m.app_dismissOriginNoticeLabel()}
            onDismiss={() => (dismissedMismatchFor = panel.activeChatId)}
          >
            <p>
              {m.app_originMismatchIntro()}<strong>{chatOriginMismatch.chatOrigin}</strong>{m.app_originMismatchViewing()}<strong
                >{chatOriginMismatch.pageOrigin}</strong
              >{m.app_originMismatchDetail()}
            </p>
          </NoticeCard>
        {/if}
      {/snippet}
    </Transcript>

    <div class="flex flex-none flex-col gap-0 px-3 pt-2 pb-3">
      <!-- Card 119: the selection attachment sits ABOVE the sharing strip,
           because it is subordinate to it — the gate governs whether it can
           exist at all — and because the strip and the composer are drawn as
           one welded unit (square corners between them) that nothing may be
           inserted into. -->
      {#if pageSharing.selection}
        <SelectionChip text={pageSharing.selection.text} onDismiss={dismissSelection} />
      {/if}
      <ContextChip
        pageInfo={panel.pageInfo}
        connectionStatus={panel.connectionStatus}
        onOpenTools={() => switchView("inspector")}
        sharing={pageSharing.sharing}
        shareContent={pageSharing.shareContent}
        onSetSharing={setSharing}
        onSetShareContent={setShareContent}
      />
      <Composer
        bind:this={composerRef}
        busy={panel.isTurnActive}
        onSend={handleSend}
        onStop={handleStop}
      >
        {#snippet picker()}
          <ModelPicker />
        {/snippet}
      </Composer>
    </div>
  {:else}
    <!-- Non-chat views take the whole panel below the header, and are left
         the way the reference's submenus are: by a Back row, not by a tab
         strip that would have to sit there permanently. -->
    <div class="flex flex-none items-center px-2 pb-1">
      <IconButton
        bind:ref={backButton}
        icon="arrow_back"
        label={m.app_backToChatLabel()}
        onclick={() => switchView("chat")}
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
        sharing={pageSharing.sharing}
      />
    {:else}
      <HistoryPanel onOpenChat={() => switchView("chat")} />
    {/if}
  {/if}
  </main>
</div>

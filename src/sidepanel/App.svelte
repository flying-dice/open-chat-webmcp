<script lang="ts">
  // Side panel app shell (card 07): header / transcript / composer, laid
  // out to stay usable down to ~320px (decisions/01, decisions/08).
  //
  // `handleSend` is the agent loop's (card 08) entry point: it resolves the
  // active provider+model from src/sidepanel/stores/selection.svelte.ts,
  // decides whether to attach page tools (only when
  // `selection.activeCapability?.status === "tool-capable"`, decisions/11),
  // and hands off to src/sidepanel/services/agentLoop.ts's `runAgentTurn`,
  // which streams the reply and drives tool-call execution/approval from
  // there. `requestApproval` is card 09's real approve/deny UI
  // (src/sidepanel/stores/approvals.svelte.ts) — Transcript.svelte renders
  // its pending requests as inline ApprovalCards, and its `policy` state is
  // kept in sync with settings.ts's global override for the lifetime of
  // this component via `initApprovalPolicySync` below.
  // `view` (card 11) switches the panel's main area between the chat
  // transcript and the tools/call-log inspector — purely local UI state,
  // not persisted, since it's a view choice rather than session content
  // (panel.svelte.ts's SINGLE OWNER note is about `ChatSession`, not this).
  import { onMount } from "svelte";
  import Header from "./components/Header.svelte";
  import Transcript from "./components/Transcript.svelte";
  import Composer from "./components/Composer.svelte";
  import ProviderPicker from "./components/ProviderPicker.svelte";
  import SegmentedControl from "./components/SegmentedControl.svelte";
  import Inspector from "./components/Inspector.svelte";
  import { initActiveTabSync } from "./services/activeTab";
  import { runAgentTurn } from "./services/agentLoop";
  import { createProviderClient } from "../lib/providers/registry";
  import { selection } from "./stores/selection.svelte";
  import { addAssistantNote, addUserMessage, panel, requestStop } from "./stores/panel.svelte";
  import { dismissAllPending, initApprovalPolicySync, requestApproval } from "./stores/approvals.svelte";

  let view = $state<"chat" | "inspector">("chat");
  const viewOptions = [
    { value: "chat", label: "Chat" },
    { value: "inspector", label: "Tools & Log" },
  ];

  /** The last user turn actually sent — card 14's Retry action chip resends this rather than requiring the user to retype it. Updated on every send, including a retry, so retrying twice in a row still resends the same original text. */
  let lastSentText = $state("");

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
    if (!info || info.restrictedReason) return undefined;
    if (info.toolCount === 0) {
      return "This page hasn't published any WebMCP tools, so there's nothing extra to call here — plain chat works exactly the same.";
    }
    return undefined;
  });

  onMount(() => {
    const teardownTabSync = initActiveTabSync();
    const teardownPolicySync = initApprovalPolicySync();
    return () => {
      teardownTabSync();
      teardownPolicySync();
    };
  });

  /**
   * Stop must also clear any approve/deny card still showing: agentLoop.ts's
   * `raceApproval` already treats an aborted turn's outstanding approval as
   * "denied" so the loop itself unblocks immediately, but it has no way to
   * settle THIS module's promise or remove the card — without this call, a
   * card the loop has already moved past would be left on screen forever.
   */
  function handleStop(): void {
    requestStop();
    dismissAllPending();
  }

  function handleSend(text: string): void {
    lastSentText = text;

    const resolution = selection.resolution;
    const tabId = panel.pageInfo?.tabId;

    if (resolution.status !== "ok" || tabId === undefined) {
      addUserMessage(text);
      const noProviders = selection.providers.length === 0;
      addAssistantNote(
        noProviders
          ? "No provider is registered yet — add one on the options page, then pick it from the picker in the header."
          : "No provider/model selected yet — pick one from the picker in the header before sending a message.",
        noProviders ? [{ kind: "open-options", label: "Open options to add a provider" }] : undefined,
      );
      return;
    }

    let provider;
    try {
      provider = createProviderClient(resolution.config);
    } catch (err) {
      addUserMessage(text);
      addAssistantNote(
        `Couldn't start a chat client for this provider: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    void runAgentTurn(text, {
      provider,
      model: resolution.model,
      tabId,
      pageTitle: panel.pageInfo?.title ?? "",
      pageOrigin: panel.pageInfo?.origin ?? "",
      attachTools: selection.activeCapability?.status === "tool-capable",
      requestApproval,
    });
  }

  /** Card 14's Retry action chip: resend the last user turn exactly as if retyped. Never touches the failed turn's messages — the partial reply and the error note both stay on screen; this only starts a new one below them. */
  function handleRetry(): void {
    if (!lastSentText) return;
    handleSend(lastSentText);
  }
</script>

<div class="app">
  <Header pageInfo={panel.pageInfo} connectionStatus={panel.connectionStatus}>
    {#snippet picker()}
      <ProviderPicker />
    {/snippet}
  </Header>
  {#if panel.pageInfo?.restrictedReason}
    <p class="restricted-banner text-small">{panel.pageInfo.restrictedReason}</p>
  {/if}

  <div class="view-switch">
    <SegmentedControl
      options={viewOptions}
      value={view}
      ariaLabel="Panel view"
      onSelect={(v) => (view = v as "chat" | "inspector")}
    />
  </div>

  {#if view === "chat"}
    <Transcript
      messages={panel.messages}
      streamingMessageId={panel.streamingMessageId}
      onRetry={handleRetry}
      {toolsNotice}
    />
    <Composer streaming={panel.isStreaming} onSend={handleSend} onStop={handleStop} />
  {:else}
    <Inspector tools={panel.tools} toolCalls={panel.toolCalls} />
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    min-width: 320px;
  }

  .view-switch {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-outline);
    background: var(--color-surface-container);
  }

  /* Restricted-page notice (card 14): visible above the view switch so it
     applies to both Chat and Tools & Log, since a restricted tab affects
     both the same way. Calm, not alarming — an ordinary configuration
     state, styled like any other secondary-text banner, no danger colour. */
  .restricted-banner {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-container);
    border-bottom: 1px solid var(--color-outline);
    color: var(--color-on-surface-variant);
  }
</style>

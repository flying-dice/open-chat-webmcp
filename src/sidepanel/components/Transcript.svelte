<script lang="ts">
  /**
   * Message list + autoscroll.
   *
   * Autoscroll rule: while the user is scrolled to (near) the bottom, new
   * content — a new message, or another token appended to a streaming
   * assistant message — keeps the view pinned to the bottom. The instant the
   * user scrolls away from the bottom, `atBottom` goes false and this stops
   * touching `scrollTop` at all; a "Jump to latest" pill appears so there is
   * always an obvious way back. Scroll position is the single source of
   * truth for `atBottom` (via the `scroll` listener below) — there is no
   * separate "user is reading" flag to fall out of sync with it.
   *
   * Message shape (decisions/18): a user turn is a right-aligned pill; an
   * assistant turn has NO bubble at all — it is bare text on the panel
   * surface, headed by a sparkle + model row and followed by copy/regenerate
   * actions. Only one side of the conversation is boxed, so the reply (the
   * long-form half) gets the full panel width and reads like a document
   * rather than a chat log.
   *
   * Card 61 (decisions/26): the flat `messages` prop is folded into display
   * groups by `groupTranscript` — user turns, assistant prose turns, and
   * activity groups (a run of tool-call steps, rendered by ActivityGroup as
   * a compact timeline instead of one full-width card per call). The old
   * 2px blinking `.cursor`/`@keyframes blink` is gone, replaced by
   * `ActivityIndicator` at the tail of the transcript while `turnPhase` is
   * `waiting` or `calling` — `streaming` needs no indicator of its own
   * (arriving text is its own feedback) and `awaiting-approval` needs none
   * either (the ApprovalCard loop below is already on screen, already
   * blocking).
   */
  import Markdown from "../../lib/components/Markdown.svelte";
  import ActivityGroup from "./ActivityGroup.svelte";
  import ActivityIndicator from "./ActivityIndicator.svelte";
  import ApprovalCard from "./ApprovalCard.svelte";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";
  import MessageActions from "./MessageActions.svelte";
  import type { PanelMessage, TurnPhase } from "../stores/panel.svelte";
  import { groupTranscript } from "../lib/transcriptGroups";
  import { approvals } from "../stores/approvals.svelte";
  import { openOptionsPage } from "../stores/selection.svelte";
  import type { IconName } from "../../lib/icons";
  import type { Snippet } from "svelte";

  interface Props {
    messages: PanelMessage[];
    streamingMessageId: string | null;
    /** The active chat's current turn phase (decisions/26, card 60) — `null` when no turn is in flight. Drives the tail `ActivityIndicator` and which activity group counts as "live" for ActivityGroup/ToolCallRow's expand/collapse and running/stalled distinction. */
    turnPhase: TurnPhase | null;
    /** Resend the last user turn (card 14) — invoked by a `"retry"` action chip on a terminal-error note. The message that failed mid-stream is left exactly as it is; this only starts a new turn. */
    onRetry: () => void;
    /**
     * First-run-only note shown alongside the empty-transcript message —
     * card 14's "page publishes no WebMCP tools" / "restricted page"
     * states, worded to make clear plain chat still works, never a
     * dead end. `undefined` when there's nothing to add.
     */
    toolsNotice?: string;
    /**
     * Notices that belong at the TOP of the thread (the restricted-page and
     * cross-origin notices App.svelte owns), rendered above the first
     * message and scrolling with it. A snippet rather than a data prop
     * because their wording is App.svelte's business, not this component's.
     */
    notices?: Snippet;
    /** Label for the model that produced the replies, shown in each assistant turn's header row. `undefined` when nothing is selected yet. */
    modelLabel?: string;
    /** Icon for the provider that produced the replies (src/lib/providers/presets.ts's `iconForProvider`), shown next to `modelLabel`. Falls back to `sparkle` when nothing is resolved yet. */
    modelIcon?: IconName;
  }

  let {
    messages,
    streamingMessageId,
    turnPhase,
    onRetry,
    toolsNotice,
    notices,
    modelLabel,
    modelIcon,
  }: Props = $props();

  /**
   * The id of the last assistant message with actual content, so only it
   * offers "Regenerate". Skips the empty toolCalls-only carriers
   * `groupTranscript` also drops from display (see that module's doc
   * comment) — without this guard, a turn that ended with a tool round
   * rather than prose would land Regenerate on a message with nothing in
   * it, one turn short of the real last reply.
   */
  const lastAssistantId = $derived(
    messages.findLast((m) => m.role === "assistant" && m.content.trim() !== "")?.id,
  );

  const groups = $derived(groupTranscript(messages));

  /** The tail live-status line's phase — `null` (nothing rendered) for `streaming` (arriving text is its own feedback) and `awaiting-approval` (the ApprovalCard loop below is already on screen and already blocking), and whenever no turn is in flight at all. */
  const tailPhase = $derived(
    turnPhase && turnPhase.kind !== "streaming" && turnPhase.kind !== "awaiting-approval"
      ? turnPhase
      : null,
  );

  /** The key of the LAST group, while a turn is in flight — the one ActivityGroup that should count as "live" (decisions/26: expanded, and its unfinished steps read as "running" rather than "stalled"). `undefined` while no turn is active, so no group is ever mistaken for live between turns. */
  const liveGroupKey = $derived(turnPhase ? groups.at(-1)?.key : undefined);

  let container: HTMLDivElement | undefined = $state();
  let atBottom = $state(true);

  // Near enough to the bottom to count as "at bottom" — big enough to
  // absorb sub-pixel rounding and a fast final token, small enough that
  // deliberately scrolling up a little still disengages autoscroll.
  const BOTTOM_THRESHOLD_PX = 48;

  function handleScroll(): void {
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    atBottom = distance <= BOTTOM_THRESHOLD_PX;
  }

  function scrollToBottom(behavior: ScrollBehavior = "auto"): void {
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
    atBottom = true;
  }

  // Re-runs on every message added AND on every in-place content mutation
  // (token-by-token streaming writes straight into a message's `.content`,
  // which this dependency read picks up). $effect runs after the DOM
  // reflects the change, so `scrollHeight` below is already current.
  //
  // Deliberately reduces over the FLAT `messages` prop, not `groups`:
  // `updateToolCallResult` (panel.svelte.ts) mutates a tool message's
  // `.content` in place on a message still sitting in `messages`, so
  // reading lengths off the flat array keeps working exactly as it always
  // has. `turnPhase?.kind` is an added dependency (card 61) — the tail
  // `ActivityIndicator` line changes the transcript's rendered height on
  // its own, independent of any message changing. Group/row EXPANSION
  // state must never enter this dependency: collapsing a group while
  // scrolled up must not yank the view back to the bottom — only new
  // content should ever do that.
  $effect(() => {
    const lengthDependency =
      messages.reduce((n, m) => n + m.content.length, messages.length) + approvals.pending.length;
    void lengthDependency;
    void turnPhase?.kind;
    if (atBottom) scrollToBottom();
  });
</script>

<div class="transcript-viewport">
  <div class="transcript" bind:this={container} onscroll={handleScroll}>
    {#if notices}
      <div class="notices">{@render notices()}</div>
    {/if}

    {#if messages.length === 0}
      <div class="empty-block">
        <p class="empty text-small">
          No messages yet. Ask something about this page, or just say hello.
        </p>
        {#if toolsNotice}
          <p class="empty text-small">{toolsNotice}</p>
        {/if}
      </div>
    {/if}

    {#each groups as group (group.key)}
      {#if group.kind === "user"}
        <div class="message" data-role="user">
          <div class="user-bubble">{group.message.content}</div>
        </div>
      {:else if group.kind === "prose"}
        {@const message = group.message}
        <div class="message" data-role="assistant">
          <div class="assistant-turn">
            <!-- The reference puts a "Show thinking" disclosure here. We
                 capture no reasoning tokens, so this row says what is
                 actually true instead: which model is answering. -->
            <div class="turn-header">
              <span class="sparkle" aria-hidden="true"><Icon name={modelIcon ?? "sparkle"} size={20} /></span>
              {#if modelLabel}<span class="turn-model">{modelLabel}</span>{/if}
            </div>

            <Markdown source={message.content} />

            {#if message.actions && message.actions.length > 0}
              <!-- Note actions (Retry, Open options) belong to an error note
                   and are not the same thing as the per-reply icon row
                   below: these are the way OUT of a failed turn, so they
                   stay full labelled buttons. -->
              <div class="note-actions">
                {#each message.actions as action, i (i)}
                  {#if action.kind === "retry"}
                    <button type="button" class="action-chip" onclick={onRetry}>Retry</button>
                  {:else if action.kind === "open-options"}
                    <button type="button" class="action-chip" onclick={openOptionsPage}>
                      {action.label}
                    </button>
                  {/if}
                {/each}
              </div>
            {/if}

            {#if message.content && message.id !== streamingMessageId}
              <MessageActions
                content={message.content}
                onRegenerate={message.id === lastAssistantId ? onRetry : undefined}
              />
            {/if}
          </div>
        </div>
      {:else}
        <div class="message" data-role="tool">
          <ActivityGroup steps={group.steps} live={group.key === liveGroupKey} />
        </div>
      {/if}
    {/each}

    {#each approvals.pending as request (request.id)}
      <div class="message" data-role="tool">
        <ApprovalCard {request} />
      </div>
    {/each}

    {#if tailPhase}
      <div class="message" data-role="assistant">
        <ActivityIndicator phase={tailPhase} {modelLabel} {modelIcon} />
      </div>
    {/if}

    {#if messages.length > 0}
      <!-- Once per thread, at the end rather than pinned above the
           composer: it is a standing caveat, not a warning about the
           message you are typing, and pinning it would cost a row of a
           320px panel forever. -->
      <p class="disclaimer">
        Replies come from the provider you configured and can be wrong — check anything that
        matters. Tool calls act on the page in front of you.
      </p>
    {/if}
  </div>

  {#if !atBottom}
    <div class="jump-to-latest">
      <IconButton
        icon="arrow_downward"
        label="Jump to latest"
        variant="filled"
        onclick={() => scrollToBottom("smooth")}
      />
    </div>
  {/if}
</div>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     and src/sidepanel/chat-theme.css (decisions/18). */

  .transcript-viewport {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }

  .transcript {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
    padding: var(--space-2) var(--space-4) var(--space-4);
    display: flex;
    flex-direction: column;
    /* Wider than the old 12px: turns need to read as separate blocks now
       that the assistant's half has no border to separate it. */
    gap: var(--space-5);
  }

  .notices {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .empty-block {
    margin: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    text-align: center;
  }

  .empty {
    margin: 0;
    text-align: center;
  }

  .message {
    display: flex;
    min-width: 0;
  }

  .message[data-role="user"] {
    justify-content: flex-end;
  }

  .message[data-role="assistant"],
  .message[data-role="tool"] {
    justify-content: flex-start;
  }

  /* The user's turn is the only boxed one. It is short, it is the thing
     being answered, and a right-aligned pill is the cheapest way to say
     "you said this" without a label or an avatar. */
  .user-bubble {
    max-width: 85%;
    min-width: 0;
    border-radius: var(--radius-xl);
    padding: var(--space-3) var(--space-5);
    background: var(--color-surface-container);
    color: var(--color-on-surface);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* No background, no border, no padding: the reply is the page. */
  .assistant-turn {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .turn-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .sparkle {
    display: inline-flex;
    color: var(--color-accent-sparkle);
  }

  .turn-model {
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .disclaimer {
    margin: 0;
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
  }

  .note-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .action-chip {
    font-size: var(--font-size-small);
    border-radius: var(--radius-pill);
    padding: var(--space-1) var(--space-2);
  }

  /* Tool-call rendering — the timeline (ActivityGroup.svelte /
     ToolCallRow.svelte, card 61), the approve/deny card, and the
     "arguments" formatting shared by both — lives in ActivityGroup.svelte /
     ToolCallRow.svelte / ApprovalCard.svelte / ToolArgs.svelte. Card 09,
     decisions/05-tool-approval-policy.md, decisions/26. */

  .jump-to-latest {
    position: absolute;
    bottom: var(--space-3);
    left: 50%;
    transform: translateX(-50%);
    border-radius: var(--radius-full);
    /* The one thing in the transcript that genuinely floats over content,
       so it is the one thing that gets a shadow. */
    box-shadow: var(--elevation-2);
  }

  .jump-to-latest :global(.icon-button) {
    border-radius: var(--radius-full);
  }
</style>

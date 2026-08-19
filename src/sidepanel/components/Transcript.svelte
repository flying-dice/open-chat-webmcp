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
   */
  import Markdown from "../../lib/components/Markdown.svelte";
  import ToolCallCard from "./ToolCallCard.svelte";
  import ApprovalCard from "./ApprovalCard.svelte";
  import type { PanelMessage } from "../stores/panel.svelte";
  import { approvals } from "../stores/approvals.svelte";
  import { openOptionsPage } from "../stores/selection.svelte";

  interface Props {
    messages: PanelMessage[];
    streamingMessageId: string | null;
    /** Resend the last user turn (card 14) — invoked by a `"retry"` action chip on a terminal-error note. The message that failed mid-stream is left exactly as it is; this only starts a new turn. */
    onRetry: () => void;
    /**
     * First-run-only note shown alongside the empty-transcript message —
     * card 14's "page publishes no WebMCP tools" / "restricted page"
     * states, worded to make clear plain chat still works, never a
     * dead end. `undefined` when there's nothing to add.
     */
    toolsNotice?: string;
  }

  let { messages, streamingMessageId, onRetry, toolsNotice }: Props = $props();

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
  $effect(() => {
    const dependency =
      messages.reduce((n, m) => n + m.content.length, messages.length) + approvals.pending.length;
    void dependency;
    if (atBottom) scrollToBottom();
  });
</script>

<div class="transcript-viewport">
  <div class="transcript" bind:this={container} onscroll={handleScroll}>
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

    {#each messages as message (message.id)}
      <div class="message" data-role={message.role}>
        {#if message.role === "user"}
          <div class="bubble user-bubble">{message.content}</div>
        {:else if message.role === "assistant"}
          <div class="bubble assistant-bubble">
            <Markdown source={message.content} />
            {#if message.id === streamingMessageId}
              <span class="cursor" aria-hidden="true"></span>
            {/if}
            {#if message.actions && message.actions.length > 0}
              <div class="message-actions">
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
          </div>
        {:else}
          <ToolCallCard {message} />
        {/if}
      </div>
    {/each}

    {#each approvals.pending as request (request.id)}
      <div class="message" data-role="tool">
        <ApprovalCard {request} />
      </div>
    {/each}
  </div>

  {#if !atBottom}
    <button class="jump-to-latest" onclick={() => scrollToBottom("smooth")}>
      ↓ Jump to latest
    </button>
  {/if}
</div>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

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
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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

  .bubble {
    max-width: 100%;
    min-width: 0;
    border-radius: var(--radius-card);
    padding: var(--space-2) var(--space-3);
    overflow-wrap: anywhere;
  }

  .user-bubble {
    background: var(--color-primary);
    color: var(--color-on-primary);
    white-space: pre-wrap;
  }

  .assistant-bubble {
    background: var(--color-surface-container);
    border: 1px solid var(--color-outline-variant);
    position: relative;
  }

  .cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    vertical-align: text-bottom;
    background: var(--color-on-surface-variant);
    margin-left: 2px;
    animation: blink 1s step-start infinite;
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  .message-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-outline-variant);
  }

  .action-chip {
    font-size: var(--font-size-small);
    border-radius: var(--radius-pill);
    padding: var(--space-1) var(--space-2);
  }

  /* Tool-call rendering (collapsed auto-run cards, the approve/deny card,
     and the "arguments" formatting shared by both) lives in
     ToolCallCard.svelte / ApprovalCard.svelte / ToolArgs.svelte — card 09,
     decisions/05-tool-approval-policy.md. */

  .jump-to-latest {
    position: absolute;
    bottom: var(--space-3);
    left: 50%;
    transform: translateX(-50%);
    font-size: var(--font-size-small);
    box-shadow: none;
  }
</style>

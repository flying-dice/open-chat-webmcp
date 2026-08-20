<script lang="ts">
  /**
   * One compact timeline step inside an ActivityGroup's rail (card 61).
   * Replaces ToolCallCard.svelte, which rendered one full-width filled card
   * PER call — at a 320-400px panel width, three calls pushed the reply off
   * screen. This is the same information, one line by default.
   *
   * `toolAnnotations` is a snapshot taken at call time (panel.svelte.ts),
   * not a live lookup — see that field's doc comment for why. Per
   * decisions/05 and decisions/17, annotations are page-supplied UX
   * guidance, not a security boundary; the badges below say only what the
   * page claimed, never that a call was verified safe.
   *
   * `ToolAnnotations` is exactly `{ readOnlyHint, untrustedContentHint }` —
   * there is no `destructiveHint` (decisions/17). When `toolAnnotations`
   * carries `untrustedContentHint: true`, the result below is the same
   * fenced text sent to the model (src/sidepanel/services/agentLoop.ts's
   * `fenceUntrustedContent`) — the badge just calls out why it reads that
   * way, so a human scanning the transcript can tell an untrusted-source
   * result apart from an ordinary one.
   *
   * Card 38 (decisions/19 §6): `message.toolOrigin`, snapshotted the same
   * way `toolAnnotations` is, names where the call ran — always visible
   * without expanding, so a completed remote call is never mistaken for a
   * local one after the fact.
   *
   * `message.toolMcpAnnotations?.title` (decisions/19 §2) is
   * attacker-influenceable text a remote MCP server chose — it is shown
   * ONLY inside the expanded payload, explicitly attributed ("The server
   * calls this: ..."). It must never become this row's label: using it as
   * the label would let a hostile server relabel `delete_all` as
   * "Read page (safe)" in the one place a user scans. ApprovalCard.svelte
   * renders the raw `call.name` for exactly this reason — this row does
   * the same, always showing `message.toolName`.
   */
  import type { PanelMessage } from "../stores/panel.svelte";
  import { originLabel } from "../../lib/mcp/merge";
  import { panel } from "../stores/panel.svelte";
  import { formatDuration } from "../lib/duration";
  import Icon from "./Icon.svelte";
  import ToolArgs from "./ToolArgs.svelte";

  interface Props {
    message: PanelMessage;
    /** Whether this step belongs to the transcript's currently-live activity group (see ActivityGroup.svelte) — governs the "running"/"stalled" distinction and whether an unfinished call's elapsed duration is shown at all. */
    live: boolean;
  }

  let { message, live }: Props = $props();

  let open = $state(false);

  const readOnly = $derived(message.toolAnnotations?.readOnlyHint === true);
  const untrustedContent = $derived(message.toolAnnotations?.untrustedContentHint === true);
  const isServerTool = $derived(message.toolOrigin?.kind === "server");

  /**
   * `message.toolStatus` as-is, except a call still `"pending"` when this
   * group is no longer live: nothing is ever going to update it now (the
   * panel closed mid-call, or the turn ended without a result ever
   * arriving) — showing an eternally "running" dot would be a lie the
   * live phase (decisions/26) exists specifically to avoid making anywhere
   * else. `"running"` is the ONLY status that isn't a `ToolCallStatus`
   * value; every render below branches on it explicitly.
   */
  const displayStatus = $derived(
    message.toolStatus !== "pending" ? (message.toolStatus ?? "pending") : live ? "running" : "stalled",
  );

  // The dot's `data-status` reuses "pending" for "running" (see the rail
  // CSS below, shared verbatim with ContextChip.svelte's status-dot
  // colour mapping) — "running" is only distinguished by `data-pulse`.
  const dotStatus = $derived(displayStatus === "running" ? "pending" : displayStatus);

  /** The matching call-log entry (src/lib/session.ts's `ToolCallLogEntry`), looked up by id — `addToolCall`/`logToolCall` (panel.svelte.ts) both key it as `call.id`, the same value used for this message's own `id`. */
  const logEntry = $derived(panel.toolCalls.find((entry) => entry.id === message.id));

  const durationLabel = $derived.by((): string | undefined => {
    const entry = logEntry;
    if (!entry) return undefined;
    if (entry.endedAt !== undefined) return formatDuration(entry.endedAt - entry.startedAt);
    // Unfinished: only say anything while this group is still live — once
    // it isn't, the stalled dot + "no result recorded" badge already carry
    // that fact, and a duration counting up forever would be misleading.
    return live ? "running…" : undefined;
  });

  const metaLabel = $derived.by((): string | undefined => {
    if (displayStatus === "stalled") return "no result recorded";
    if (message.toolMode === "auto") return readOnly ? "auto · read-only" : "auto-run";
    if (message.toolMode === "approved") return "approved";
    if (message.toolMode === "denied") return "denied";
    return undefined;
  });

  const showErrorLine = $derived(
    (displayStatus === "error" || displayStatus === "denied") && message.content.trim() !== "",
  );
</script>

<li class="step">
  <span class="dot" data-status={dotStatus} data-pulse={displayStatus === "running"} aria-hidden="true"
  ></span>

  <div class="row-body">
    <button type="button" class="row-head" aria-expanded={open} onclick={() => (open = !open)}>
      <span class="tool-name" title={message.toolName}>{message.toolName}</span>

      {#if message.toolOrigin === undefined}
        <span class="origin origin-unknown">origin unknown</span>
      {:else if isServerTool}
        <span class="origin origin-server">{originLabel(message.toolOrigin)}</span>
      {:else}
        <span class="origin origin-page text-small">this page</span>
      {/if}

      {#if durationLabel}
        <span class="duration text-small">{durationLabel}</span>
      {/if}

      <span class="chevron" class:open aria-hidden="true"><Icon name="chevron_right" size={16} /></span>
    </button>

    {#if untrustedContent || metaLabel}
      <div class="meta-line text-small">
        {#if untrustedContent}
          <span class="meta-badge meta-untrusted">untrusted content</span>
        {/if}
        {#if metaLabel}
          <span
            class="meta-badge"
            title={displayStatus === "stalled"
              ? "The side panel closed, or the turn ended, before this call reported back — it may still have run on the other end."
              : undefined}
          >
            {metaLabel}
          </span>
        {/if}
      </div>
    {/if}

    {#if showErrorLine}
      <!-- Never hidden behind the payload toggle — this is precisely why
           the payload below can default closed. -->
      <p class="step-error text-small">{message.content}</p>
    {/if}

    {#if open}
      <div class="payload">
        <div class="args-section">
          <h3>Arguments</h3>
          <ToolArgs args={message.toolArgs} />
        </div>

        {#if message.toolMcpAnnotations?.title}
          <p class="server-title text-small">
            The server calls this: "{message.toolMcpAnnotations.title}"
          </p>
        {/if}

        {#if message.content}
          <div class="result-section" data-status={displayStatus}>
            <h3>
              {displayStatus === "error" || displayStatus === "denied" ? "Error" : "Result"}
              {#if untrustedContent && displayStatus === "success"}
                <span class="untrusted-note">— page-authored, treated as untrusted data</span>
              {/if}
            </h3>
            <div
              class="tool-content text-small"
              data-untrusted={untrustedContent && displayStatus === "success"}
            >{message.content}</div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</li>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     and src/sidepanel/chat-theme.css (decisions/18). */

  .step {
    display: grid;
    grid-template-columns: 12px minmax(0, 1fr);
    column-gap: var(--space-2);
  }

  /* Colour mapping deliberately mirrors ContextChip.svelte's existing
     status dot (~:155-183) so a coloured dot means the same thing
     everywhere in the panel. */
  .dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    margin: 6px 0 0 2px;
    /* Punches the rail line through cleanly rather than overlapping it. */
    box-shadow: 0 0 0 2px var(--color-surface);
  }

  .dot[data-status="success"] {
    background: var(--color-success);
  }

  .dot[data-status="error"],
  .dot[data-status="denied"] {
    background: var(--color-danger);
  }

  .dot[data-status="pending"] {
    background: var(--color-primary);
  }

  .dot[data-status="stalled"] {
    background: transparent;
    box-shadow: 0 0 0 2px var(--color-surface), inset 0 0 0 1px var(--color-outline);
  }

  .dot[data-pulse="true"] {
    animation: dot-pulse var(--duration-pulse) ease-in-out infinite;
  }

  @keyframes dot-pulse {
    50% {
      opacity: 0.35;
      transform: scale(0.8);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot[data-pulse="true"] {
      animation: none;
    }
  }

  .row-body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .row-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
    padding: var(--space-1) 0;
    background: transparent;
    border: none;
    border-radius: 0;
    text-align: left;
  }

  .row-head:hover .tool-name {
    text-decoration: underline;
  }

  .tool-name {
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--font-family-mono);
    font-size: var(--font-size-small);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .origin {
    flex: none;
    font-size: var(--font-size-small);
    white-space: nowrap;
  }

  .origin-page {
    color: var(--color-on-surface-variant);
  }

  /* Decisions/19 §6 — same tinted-primary badge treatment as
     ToolListItem.svelte/CallLogEntry.svelte so a remote call reads
     consistently everywhere in the panel. */
  .origin-server {
    color: var(--color-primary);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-sm);
    padding: 1px var(--space-1);
    line-height: 1;
  }

  /* A hallucinated tool name — never defaulted to "this page". */
  .origin-unknown {
    color: var(--color-on-surface-variant);
    border: 1px dashed var(--color-outline);
    border-radius: var(--radius-sm);
    padding: 1px var(--space-1);
    line-height: 1;
  }

  .duration {
    flex: none;
    color: var(--color-on-surface-variant);
    white-space: nowrap;
  }

  .chevron {
    flex: none;
    display: inline-flex;
    transition: transform var(--transition-fast);
    color: var(--color-on-surface-variant);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .meta-line {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .meta-badge {
    font-size: var(--font-size-small);
    line-height: 1;
    padding: 2px var(--space-1);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-outline);
    color: var(--color-on-surface-variant);
    white-space: nowrap;
  }

  /* theme.css has no separate "warning" token (decisions/08) — this reuses
     --color-danger, the only attention colour available, purely to catch
     the eye; it does not imply the call itself is dangerous to make. */
  .meta-untrusted {
    color: var(--color-danger);
    border-color: var(--color-danger);
  }

  .step-error {
    margin: 0;
    color: var(--color-danger);
    overflow-wrap: anywhere;
  }

  .payload {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    margin-top: var(--space-1);
    background: var(--color-surface-container);
    border-radius: var(--radius-sm);
  }

  .args-section h3,
  .result-section h3 {
    margin-bottom: var(--space-1);
  }

  .server-title {
    margin: 0;
    color: var(--color-on-surface-variant);
    font-style: italic;
    overflow-wrap: anywhere;
  }

  .untrusted-note {
    font-size: var(--font-size-small);
    font-weight: 400;
    color: var(--color-danger);
  }

  .tool-content {
    padding: var(--space-2);
    background: var(--color-surface);
    border-radius: var(--radius-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* Marks the exact block of text that came back from an
     `untrustedContentHint` tool (decisions/17) — the same fenced text sent
     to the model, minus the delimiters themselves (see
     src/sidepanel/services/agentLoop.ts's `fenceUntrustedContent`). */
  .tool-content[data-untrusted="true"] {
    border: 1px dashed var(--color-danger);
  }

  .result-section[data-status="error"] .tool-content,
  .result-section[data-status="denied"] .tool-content {
    color: var(--color-danger);
  }
</style>

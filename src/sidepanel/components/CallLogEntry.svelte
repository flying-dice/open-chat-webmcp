<script lang="ts">
  /**
   * One entry in the Call Log (card 11 — the accountability surface,
   * decisions/05-tool-approval-policy.md: "nothing happens invisibly").
   * Reuses ToolArgs.svelte/ToolArgValue.svelte for arguments and results
   * rather than a third renderer, same as ApprovalCard.svelte/
   * ToolCallCard.svelte do for the transcript.
   *
   * Starts expanded for anything a human had to decide on or that didn't
   * simply succeed (`approved`, `denied`, or an error) — mirroring
   * ToolCallCard.svelte's rule — because per decisions/05 "a denied call
   * must be as visible as a successful one": a denied entry gets the same
   * danger-coloured treatment a failed one does, never a quieter one.
   * Auto-run successes start collapsed since nobody had to review them.
   *
   * Card 38 (decisions/19 §6): `entry.origin`, recorded alongside args and
   * result by src/lib/session.ts's `logToolCall`, is shown next to the call
   * name — the call log is the accountability surface, so it must say where
   * every logged call ran, not just what it did.
   */
  import { untrack } from "svelte";
  import type { ToolCallLogEntry } from "../stores/panel.svelte";
  import { originLabel } from "../../lib/mcp/merge";
  import ToolArgs from "./ToolArgs.svelte";
  import ToolArgValue from "./ToolArgValue.svelte";

  interface Props {
    entry: ToolCallLogEntry;
  }

  let { entry }: Props = $props();

  const status = $derived.by((): "pending" | "success" | "error" => {
    if (entry.endedAt === undefined) return "pending";
    return entry.error !== undefined ? "error" : "success";
  });

  let expanded = $state(
    untrack(() => entry.mode !== "auto" || entry.endedAt === undefined || entry.error !== undefined),
  );

  const modeLabel: Record<ToolCallLogEntry["mode"], string> = {
    auto: "auto-run",
    approved: "approved",
    denied: "denied",
  };

  const durationLabel = $derived.by(() => {
    if (entry.endedAt === undefined) return "running…";
    const ms = entry.endedAt - entry.startedAt;
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  });

  const timeLabel = $derived(new Date(entry.startedAt).toLocaleTimeString());

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyAsJson(): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1200);
    } catch {
      // Clipboard access can fail (no permission, insecure context, etc.) —
      // the button just silently doesn't confirm; nothing else depends on it.
    }
  }
</script>

<div class="log-entry" data-mode={entry.mode} data-status={status}>
  <div class="log-header">
    <button
      type="button"
      class="toggle"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      <span class="chevron" class:open={expanded} aria-hidden="true">▸</span>
      <span class="call-name">{entry.name}</span>
      {#if entry.origin}
        <span class="badge" class:badge-server={entry.origin.kind === "server"}>
          {originLabel(entry.origin)}
        </span>
      {/if}
    </button>

    <span class="log-meta">
      <span class="badge badge-{entry.mode}">{modeLabel[entry.mode]}</span>
      <span class="duration text-small" title={timeLabel}>{durationLabel}</span>
    </span>

    <button type="button" class="copy-button text-small" onclick={copyAsJson}>
      {copied ? "Copied" : "Copy JSON"}
    </button>
  </div>

  {#if expanded}
    <div class="log-body">
      <div class="args-section">
        <h3>Arguments</h3>
        <ToolArgs args={entry.arguments} />
      </div>

      {#if entry.error !== undefined}
        <div class="result-section">
          <h3>Error</h3>
          <p class="error-text text-small">{entry.error}</p>
        </div>
      {:else if entry.result !== undefined}
        <div class="result-section">
          <h3>Result</h3>
          <ToolArgValue value={entry.result} />
        </div>
      {:else}
        <p class="pending-text text-small">Still running…</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .log-entry {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--color-outline);
    border-radius: var(--radius-card);
    background: var(--color-surface);
    overflow: hidden;
  }

  .log-entry[data-mode="denied"] {
    border-color: var(--color-danger);
  }

  .log-entry[data-status="error"] {
    border-color: var(--color-danger);
  }

  .log-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    width: 100%;
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-container);
  }

  .toggle {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 0;
    text-align: left;
  }

  .toggle:hover {
    background: transparent;
  }

  .chevron {
    flex: 0 0 auto;
    display: inline-block;
    transition: transform var(--transition-fast);
    color: var(--color-on-surface-variant);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .call-name {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-small);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .log-meta {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .badge {
    font-size: var(--font-size-small);
    line-height: 1;
    padding: 2px var(--space-1);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-outline);
    white-space: nowrap;
  }

  .badge-auto {
    color: var(--color-on-surface-variant);
  }

  .badge-approved {
    color: var(--color-primary);
    border-color: var(--color-primary);
  }

  .badge-denied {
    background: var(--color-danger);
    border-color: var(--color-danger);
    color: var(--color-on-primary);
    font-weight: 600;
  }

  /* Decisions/19 §6 — the origin badge, same tinted-primary treatment as
     ToolListItem.svelte/ToolCallCard.svelte's so a remote call reads
     consistently everywhere it's named. */
  .badge-server {
    color: var(--color-primary);
    border-color: var(--color-primary);
  }

  .duration {
    white-space: nowrap;
  }

  .copy-button {
    flex: 0 0 auto;
    padding: var(--space-1) var(--space-2);
  }

  .log-body {
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-top: 1px solid var(--color-outline-variant);
  }

  .args-section h3,
  .result-section h3 {
    margin-bottom: var(--space-1);
  }

  .error-text {
    margin: 0;
    color: var(--color-danger);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .pending-text {
    margin: 0;
    font-style: italic;
  }
</style>

<script lang="ts">
  /**
   * The single live status line, rendered at the TAIL of the transcript
   * while a turn is in flight (card 61, decisions/26). Replaces the old 2px
   * blinking `.cursor` — this says what is actually happening, in place of
   * a bar that said nothing.
   *
   * Only rendered for `waiting`/`calling` phases — Transcript.svelte filters
   * `streaming` (arriving text is its own feedback: it's landing right
   * above this line) and `awaiting-approval` (an ApprovalCard is already on
   * screen and already blocking) before this component ever mounts.
   *
   * NO VERB DICTIONARY (decisions/26): the sentence says the tool's name and
   * where it runs, nothing more — never "Reading the page…" or "Thinking…".
   * "Thinking" specifically is a claim Transcript.svelte already refuses to
   * make (see its header comment, ~line 128): no reasoning tokens are
   * captured, so there is nothing to disclose.
   */
  import { untrack } from "svelte";
  import Icon from "./Icon.svelte";
  import { originLabel } from "../../lib/mcp/merge";
  import type { TurnPhase } from "../stores/panel.svelte";
  import type { IconName } from "../../lib/icons";
  import { formatDuration } from "../lib/duration";

  /**
   * Narrowed to the two phases this component ever renders — Transcript.svelte's
   * `tailPhase` already excludes `streaming`/`awaiting-approval` (see that
   * component's doc comment), so the type itself says so too rather than
   * leaving the full `TurnPhase` union and having to fall through an
   * unreachable `else` below.
   */
  type RenderablePhase = Extract<TurnPhase, { kind: "waiting" } | { kind: "calling" }>;

  interface Props {
    phase: RenderablePhase;
    modelLabel?: string;
    /** Icon for the provider being waited on — same as Transcript.svelte's turn-header icon, so "waiting" and "answered" show the same glyph for the same provider. */
    modelIcon?: IconName;
  }

  let { phase, modelLabel, modelIcon }: Props = $props();

  const sentence = $derived.by((): string => {
    if (phase.kind === "waiting") return `Waiting for ${modelLabel ?? "the model"}…`;
    // phase.kind === "calling"
    return phase.origin
      ? `Calling ${phase.toolName} on ${originLabel(phase.origin)}…`
      : `Calling ${phase.toolName}…`;
  });

  const startedAt = $derived(phase.kind === "calling" ? phase.startedAt : undefined);

  // Elapsed time, ticked once a second — owned by an $effect keyed on
  // `startedAt` so a fresh call (a new `startedAt`) restarts the counter
  // rather than continuing a stale one. Only rendered once >=1s has passed
  // (see `elapsedLabel` below) so a fast call never flashes a number.
  let elapsedMs = $state(0);

  $effect(() => {
    const start = startedAt;
    if (start === undefined) {
      elapsedMs = 0;
      return;
    }
    // Read once, untracked, so this effect doesn't also depend on its own
    // write to `elapsedMs` below (which would just be a no-op dependency,
    // but untracking makes the intent explicit).
    untrack(() => {
      elapsedMs = Date.now() - start;
    });
    const interval = setInterval(() => {
      elapsedMs = Date.now() - start;
    }, 1000);
    return () => clearInterval(interval);
  });

  const elapsedLabel = $derived(elapsedMs >= 1000 ? formatDuration(elapsedMs) : undefined);
</script>

<div class="activity-indicator">
  <span class="glyph" aria-hidden="true">
    <Icon name={phase.kind === "waiting" ? (modelIcon ?? "sparkle") : "build"} size={16} />
  </span>
  <span class="sentence shimmer" aria-live="polite">{sentence}</span>
  {#if elapsedLabel}
    <span class="elapsed text-small" aria-hidden="true">{elapsedLabel}</span>
  {/if}
</div>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     and src/sidepanel/chat-theme.css (decisions/18). */

  .activity-indicator {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .glyph {
    display: inline-flex;
    flex: none;
    color: var(--color-accent-sparkle);
  }

  .sentence {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .elapsed {
    flex: none;
    color: var(--color-on-surface-variant);
  }

  /* The shimmering sweep — this repo's first `prefers-reduced-motion`
     handling (decisions/26), kept scoped to this one component next to the
     animation it disables rather than a global `* { animation: none }`,
     which would also defeat Tooltip.svelte's deliberate `transition-delay`
     anti-strobe mechanism. */
  .shimmer {
    background-image: linear-gradient(
      90deg,
      var(--color-on-surface-variant) 0%,
      var(--color-on-surface) 45%,
      var(--color-on-surface-variant) 90%
    );
    background-size: 200% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    animation: shimmer-sweep var(--duration-shimmer) linear infinite;
  }

  @keyframes shimmer-sweep {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .shimmer {
      animation: none;
      background-image: none;
      color: var(--color-on-surface-variant);
    }
  }
</style>

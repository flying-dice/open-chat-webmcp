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
   *
   * Card 67 (decisions/28-shadcn-svelte-maia-zinc.md): scoped CSS replaced
   * with Tailwind utilities, except the shimmering-text sweep, which is the
   * decision's explicitly carved-out custom-CSS exception — Tailwind has no
   * utility for an animated background-clip:text gradient.
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

<div class="flex min-w-0 items-center gap-2">
  <span class="inline-flex flex-none text-primary" aria-hidden="true">
    <Icon name={phase.kind === "waiting" ? (modelIcon ?? "sparkle") : "build"} size={16} />
  </span>
  <span class="shimmer min-w-0 flex-1 truncate" aria-live="polite">{sentence}</span>
  {#if elapsedLabel}
    <span class="flex-none text-xs whitespace-nowrap text-muted-foreground" aria-hidden="true"
      >{elapsedLabel}</span
    >
  {/if}
</div>

<style>
  /* The shimmering sweep — this repo's first `prefers-reduced-motion`
     handling (decisions/26), kept scoped to this one component. Tailwind
     has no utility for an animated background-clip:text gradient, so this
     is decisions/28's explicitly-allowed custom-CSS exception. Colours
     reference the shadcn Zinc tokens (src/app.css) directly rather than
     `--color-on-surface(-variant)`, which lived in chat-theme.css — deleted
     wholesale by card 72. The 1800ms duration is likewise hardcoded rather
     than reading that sheet's `--duration-shimmer` custom property. */
  .shimmer {
    background-image: linear-gradient(
      90deg,
      var(--muted-foreground) 0%,
      var(--foreground) 45%,
      var(--muted-foreground) 90%
    );
    background-size: 200% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    animation: shimmer-sweep 1800ms linear infinite;
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
      color: var(--muted-foreground);
    }
  }
</style>

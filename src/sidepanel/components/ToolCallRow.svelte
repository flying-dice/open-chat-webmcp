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
   * fenced text sent to the model (src/domain/chat/message.ts's
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
   *
   * Card 67 (decisions/28-shadcn-svelte-maia-zinc.md): re-skinned onto
   * shadcn's Collapsible (payload disclosure) and Badge (origin/meta
   * pills); the pulsing "running" dot now uses Tailwind's own
   * `animate-pulse` rather than a hand-rolled keyframe — close enough to
   * the old scale+fade that it doesn't need decisions/28's custom-CSS
   * carve-out.
   */
  import type { TranscriptEntry } from "../../domain/chat";
  import { originLabel } from "../presentation/toolOrigin";
  import { panel } from "../stores/panel.svelte";
  import { formatDuration } from "../presentation/duration";
  import { cn } from "$lib/utils";
  import Icon from "./Icon.svelte";
  import ToolArgs from "./ToolArgs.svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Badge } from "$lib/components/ui/badge";

  interface Props {
    message: TranscriptEntry;
    /** Whether this step belongs to the transcript's currently-live activity group (see ActivityGroup.svelte) — governs the "running"/"stalled" distinction and whether an unfinished call's elapsed duration is shown at all. */
    live: boolean;
  }

  let { message, live }: Props = $props();

  let open = $state(false);

  // TODO: clean-code - 0.3 - COUPLING: re-derives the same readOnly/untrustedContent/isServerTool booleans from a tool's annotations/origin as AnnotationBadges.svelte (which ApprovalCard.svelte and ToolListItem.svelte now share) instead of joining that one derivation — a change to what counts as "read-only" or "server tool" has to be mirrored in both. Not folded in by card 81: this row derives from a transcript message's toolAnnotations/toolOrigin, not from a tool, and renders a different, smaller badge set.
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
    message.toolStatus !== "pending"
      ? (message.toolStatus ?? "pending")
      : live
        ? "running"
        : "stalled",
  );

  // The dot's colour reuses "pending"'s for "running" (see `dotClass`
  // below) — "running" is only distinguished by the pulse animation.
  const dotStatus = $derived(displayStatus === "running" ? "pending" : displayStatus);

  /**
   * Tailwind classes for the status dot — mirrors ContextChip.svelte's
   * favicon status-dot colour mapping so a coloured dot means the same
   * thing everywhere in the panel. "success" has no token of its own in
   * the Zinc palette (base colours are neutral by design), so this reaches
   * for Tailwind's stock emerald swatch — the one place in this migration
   * that needs an unambiguous "this succeeded" green.
   */
  const dotClass = $derived.by((): string => {
    switch (dotStatus) {
      case "success":
        return "bg-emerald-500 dark:bg-emerald-400";
      case "error":
      case "denied":
        return "bg-destructive";
      case "stalled":
        return "bg-transparent ring-1 ring-inset ring-border";
      default:
        // "pending" (including the "running" alias above).
        return "bg-primary";
    }
  });

  /** The matching call-log entry (src/domain/chat/session.ts's `ToolCallLogEntry`), looked up by id — `addToolCall` (src/sidepanel/stores/panel.svelte.ts) and `logToolCall` (src/domain/chat/session.ts) both key it as `call.id`, the same value used for this message's own `id`. */
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

  const resultIsError = $derived(displayStatus === "error" || displayStatus === "denied");
</script>

<!-- `step`/`row-head` class names carry no styling of their own — kept
     purely so verify/checks/screenshots.mjs's `.step .row-head` locator
     (its activity-payload screenshot, predating accessible-name-based
     lookups) keeps finding this row rather than silently skipping that
     shot. -->
<li class="step grid grid-cols-[12px_minmax(0,1fr)] gap-x-2">
  <span
    class={cn(
      // `relative` is load-bearing, not cosmetic: ActivityGroup.svelte draws
      // the connecting rail as an absolutely-positioned `before:` on the
      // <ol>, which — being positioned with `z-index: auto` — paints above
      // every static child and was slicing each dot in half down the middle
      // (visible in light mode, where the rail is a pale grey line straight
      // through a red or green circle). Making the dot positioned too puts
      // it in the same layer, where tree order wins and it paints on top,
      // with the background-coloured ring below punching the rail out
      // cleanly around it.
      "relative mt-1.5 ml-0.5 size-2 shrink-0 rounded-full shadow-[0_0_0_2px_var(--background)]",
      dotClass,
      displayStatus === "running" && "animate-pulse",
    )}
    aria-hidden="true"
  ></span>

  <Collapsible.Root bind:open class="flex min-w-0 flex-col gap-1">
    <Collapsible.Trigger class="row-head group flex w-full min-w-0 items-center gap-2 py-1 text-left">
      <span
        class="min-w-0 flex-1 truncate font-mono text-code group-hover:underline"
        title={message.toolName}>{message.toolName}</span
      >

      {#if message.toolOrigin === undefined}
        <!-- A hallucinated tool name — never defaulted to "this page". -->
        <Badge variant="outline" class="flex-none border-dashed text-muted-foreground"
          >origin unknown</Badge
        >
      {:else if isServerTool}
        <!-- Decisions/19 §6 — same tinted-primary badge treatment as
             ToolListItem.svelte/CallLogEntry.svelte so a remote call reads
             consistently everywhere in the panel. -->
        <Badge variant="outline" class="flex-none border-primary text-primary"
          >{originLabel(message.toolOrigin)}</Badge
        >
      {:else}
        <span class="flex-none text-xs whitespace-nowrap text-muted-foreground">this page</span>
      {/if}

      {#if durationLabel}
        <span class="flex-none text-xs whitespace-nowrap text-muted-foreground">{durationLabel}</span>
      {/if}

      <span
        class={cn(
          "flex-none text-muted-foreground transition-transform duration-150",
          open && "rotate-90",
        )}
        aria-hidden="true"><Icon name="chevron_right" class="size-4" /></span
      >
    </Collapsible.Trigger>

    {#if untrustedContent || metaLabel}
      <div class="flex flex-wrap gap-1">
        {#if untrustedContent}
          <!-- The Zinc palette has no separate "warning" token —
               this reuses `destructive`, the only attention colour
               available, purely to catch the eye; it does not imply the
               call itself is dangerous to make. -->
          <Badge variant="outline" class="border-destructive text-destructive">untrusted content</Badge>
        {/if}
        {#if metaLabel}
          <Badge
            variant="outline"
            title={displayStatus === "stalled"
              ? "The side panel closed, or the turn ended, before this call reported back — it may still have run on the other end."
              : undefined}>{metaLabel}</Badge
          >
        {/if}
      </div>
    {/if}

    {#if showErrorLine}
      <!-- Never hidden behind the payload toggle — this is precisely why
           the payload below can default closed. -->
      <p class="m-0 text-sm text-destructive [overflow-wrap:anywhere]">{message.content}</p>
    {/if}

    <Collapsible.Content>
      <div class="mt-1 flex flex-col gap-2 rounded-lg bg-muted p-2">
        <div>
          <h3 class="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Arguments</h3>
          <ToolArgs args={message.toolArgs} />
        </div>

        {#if message.toolMcpAnnotations?.title}
          <p class="m-0 text-xs text-muted-foreground italic [overflow-wrap:anywhere]">
            The server calls this: "{message.toolMcpAnnotations.title}"
          </p>
        {/if}

        {#if message.content}
          <div>
            <h3 class="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {resultIsError ? "Error" : "Result"}
              {#if untrustedContent && displayStatus === "success"}
                <span class="font-normal text-destructive"
                  >— page-authored, treated as untrusted data</span
                >
              {/if}
            </h3>
            <!-- Marks the exact block of text that came back from an
                 `untrustedContentHint` tool (decisions/17) — the same
                 fenced text sent to the model, minus the delimiters
                 themselves (see src/domain/chat/message.ts's `fenceUntrustedContent`). -->
            <div
              class={cn(
                "rounded-lg bg-background p-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]",
                resultIsError && "text-destructive",
                untrustedContent && displayStatus === "success" && "border border-dashed border-destructive",
              )}
            >{message.content}</div>
          </div>
        {/if}
      </div>
    </Collapsible.Content>
  </Collapsible.Root>
</li>
